# Plan de implementación: clientes y compras SICAR en el CRM

> Para quien implemente: ejecutar por tareas con TDD y `superpowers:executing-plans`.
> Este documento NO autoriza implementar, desplegar, hacer commits ni cambiar otro archivo.
> La revisión independiente posterior debe hacerla alguien distinto del implementador;
> si implementa Codex, no puede revisar Codex, conforme a `CLAUDE.md`.

**Objetivo:** consultar en el CRM los clientes identificados de SICAR y sus compras con artículos,
sin incorporar movimientos al dinero del POS de CORPUNISOUND.

**Arquitectura propuesta:** agente externo de solo lectura por tienda, envío HTTPS con llave propia,
tablas separadas en el SQLite existente y consultas paginadas para el CRM. Identidades SICAR
reversiblemente vinculadas a clientes existentes; ningún cliente, ticket o detalle importado se
inserta en el JSON `estado.datos`. Las funciones y archivos nuevos de este plan son propuestas,
no componentes que ya existan.

**Tecnologías verificadas:** Node, Express, React, `better-sqlite3` ya instalado,
`node:test`, `node:crypto` y `node:zlib`. Cero dependencias nuevas.

**Especificación:** solicitud de Victor del 13-10-2026 reproducida en las decisiones de este plan.
Antecedentes leídos: `docs/superpowers/specs/2026-07-12-migracion-datos-sicar-design.md`
y `docs/superpowers/specs/2026-07-15-historial-ventas-prediccion-design.md`.
Sus flujos Excel/CSV son anteriores: no sustituyen este contrato ni prueban el esquema MySQL.

## 1. Para Victor

Verás clientes de Ocosingo y, después, de las otras tres tiendas en el CRM.
Cada ficha mostrará cuánto compraron, cuántas compras tienen y cuándo fue la última.
Podrás abrir una compra y ver sus artículos, cantidades e importes, con la etiqueta
**«SICAR, tienda Ocosingo»** o la tienda correspondiente.
Si un teléfono coincide con una persona ya registrada, aparecerá una unión pendiente de revisión.
Confirmar o deshacer esa unión no cambiará lo que se cobró ni borrará compras.
Las tiendas seguirán cobrando en SICAR; este trabajo no enciende el POS de CORPUNISOUND.
No cambiarán cortes, efectivo, inventario, monedero, saldos, utilidad ni metas de venta del POS.
Los riesgos son teléfonos compartidos, cancelaciones tardías, información histórica incompleta
y llenar el disco: cada uno tiene una prueba y una condición de paro en este documento.

## 2. Base comprobada y límites de esta investigación

- Rama comprobada: `master`; HEAD: `9c03532`. `git diff --name-only` inicialmente vacío.
- Había archivos sin seguimiento antes del trabajo, entre ellos `.agents/`, `.claude/`,
  `backend/resetPasswordLocal.js` y varios documentos. No pertenecen a esta entrega.
- Git avisó que no puede leer su archivo global de exclusiones ni `graphify-out/`.
  La comprobación final debe declarar ese límite; no afirmar que todo el árbol está limpio.
- No se conectó a MySQL, Render ni Drive; no se ejecutaron servidores ni pruebas que escriban datos.
- El esquema SICAR y sus 92 mil ventas son información proporcionada por Victor, no observaciones
  hechas contra la tienda. No se presupone disponible `feature/sicar-ingesta`.

| Evidencia leída en esta base | Consecuencia para el diseño |
| --- | --- |
| `backend/persistencia.js`: `cargar()` hace `JSON.parse`; `guardar(db)` hace `JSON.stringify(db)` y reemplaza `estado`, fila 1. Exporta solo cargar/guardar. | Hace falta una interfaz controlada para las tablas nuevas; no agregar colecciones SICAR a DB. |
| `backend/server.js`: carga persistencia, construye DB en memoria y mezcla el estado cargado; middleware de mutaciones llama `guardar(DB)` después de responder JSON. | Ingesta debe confirmar COMMIT antes del 200 y evitar ese guardado automático del JSON. |
| `backend/server.js:157`: parser global de 50 MB. | El límite SICAR debe instalarse antes de ese parser, no después. |
| `backend/respaldos.js`: formato 2, foto de colecciones JSON; omite tablas SQLite externas. `respaldoCifrado.js` usa gzip + AES-256-GCM sobre buffers. | Agregar tablas no las respalda automáticamente. Se requiere entrega de respaldo/restauración antes de producción. |
| `backend/crm.js`: `comprasDeCliente` lee ventas cerradas y detalles POS; lista incorpora compras completas; score combina monto, frecuencia y recencia. | Nuevo proveedor de resúmenes sin cargar todo el historial SICAR; mantener las fórmulas. |
| `backend/crm.js`: resumen agrupa por sucursal del cliente; ranking por vendedor asignado al cliente, no por vendedor del ticket. | No confundir cartera con comisión o productividad; resolver compras entre tiendas con Victor. |
| `backend/server.js:657,670`: existen `resolverAlcance` y `resolverAlcanceAutorizado`; varias rutas CRM por id usan el primero. | Hay un riesgo real de usar selector como autorización, aunque un comentario diga token. Corregir rutas tocadas. |
| `src/CRM.jsx`: 696 líneas; carga listas completas, calcula totales con `compras`, convierte ids con `Number` y muestra «automático desde el POS». | No basta sumar un arreglo: cambiar contrato de lectura, paginación, claves y textos. |
| `backend/clientes.js`: `crearCliente` permite teléfono vacío; la ruta aplica `validarContactoCliente`. Normalización compara últimos 10 dígitos. | No debilitar el alta manual; permitir vacío solo en las identidades importadas. |
| `clientes.js`: lista blanca de edición y validación vendedor/sucursal; RFC predeterminado XAXX010101000. | No copiar dinero ni usar RFC, nombre o ids SICAR como id nativo. |
| `backend/migracion.js`: cliente coincide por clave+sucursal; sin clave crea uno nuevo; usa crear/actualizarCliente. | No reutilizar su matching ni aplicadores para el agente. Excel puede haber dejado duplicados. |
| `backend/historialVentas.js`: CSV agrega por producto/mes en `pos.historial_ventas_mensual`. | No es historial por cliente; no reutilizarlo ni sumar estos agregados al CRM. |
| `backend/gerenteVentas.js`: generar/sincronizar tareas calculan última compra recorriendo POS; progreso y sugerencia de meta también usan POS. | Solo seguimiento de clientes recibirá última compra combinada; metas seguirán separadas. |
| `backend/radarDemanda.js`: valida cliente nativo de su sucursal y busca teléfono local al crear demanda con CRM. | Una unión no debe mover demandas, consentimiento, vendedor ni sucursal. |
| `backend/cajas.js:163`: `esDeEstaCaja` considera sin caja a la predeterminada. | Una venta SICAR con caja nula dentro de POS sí contaminaría efectivo: aislamiento estructural obligatorio. |
| `backend/cortes.js`: `calcularCorteEnCurso`; `backend/reportes.js`: `reporteUtilidad`. | Usarlos en la prueba de no contaminación, no crear cálculos alternativos. |
| `permisosCatalogo.js`, `validarPermisos.js`, `roles.js`: catálogo/guard y reconciliación Administrador; siembra de gerente por exclusiones. | Registrar permisos y evitar concesión accidental al sembrar roles nuevos. |
| `backend/instrument.js`: Sentry depura secretos por nombre y permite variables locales. | El cuerpo con datos personales necesita exclusión explícita en esta integración. |

Pruebas leídas: `crmAgregados.test.js`, `crmEstadoCliente.test.js`, `clientesDuplicados.test.js`,
`clientesAlcanceVendedor.test.js`, `clientesListaBlanca.test.js`, `radarVinculoCrm.test.js`.
También se localizaron consumidores en `filtradoDatos.test.js`, `radarDemandaRutas.test.js`
y las rutas del servidor. No se afirma que las pruebas pasaron: en esta sesión solo se planifica.

## 3. Restricciones globales y criterios de revisión

- En esta sesión solo se crea este documento. Las listas de archivos siguientes son propuestas
  para una implementación posterior autorizada, no permisos de escritura actuales.
- Ninguna dependencia, instalación, commit, push, merge, rebase ni `git add .`.
- Nunca tocar `render.yaml`; nunca subir Excel, respaldos temporales o adjuntos al disco de Render.
- Máximo 200 caracteres en cada línea `.js`/`.jsx` nueva o modificada de `src/` y `backend/`.
  Hay líneas largas preexistentes en CRM: dividir las que se toquen, no reformatear todo el repo.
- No ejecutar suite completa en worktree. Pruebas Windows siempre con ambas banderas de symlinks.
- Validaciones de dinero, alcance y permisos en servidor; lista blanca que falla cerrando.
- Cinco focos de revisión: reintentos/reordenamiento (T1b), unión equivocada (T2a), fuga entre
  sucursales (T3a), restauración que revive llaves (T1c) y cancelaciones antiguas (T4a).
- Una regla de negocio no decidida detiene solamente la tarea dependiente. No elegir una opción
  de las preguntas abiertas porque parezca conveniente; las recomendaciones no son autorizaciones.

## 4. F0 — Reconocimiento SICAR, sin escribir ni bloquear tablas

**Entregable:** diccionario firmado por quien mantiene el agente: tablas/columnas, llaves e índices,
semántica de estados/importes, ejemplos anonimizados y medición de consultas en Ocosingo.
Solo esa persona ejecuta las siguientes consultas en el servidor de tienda.
No se da acceso remoto a MySQL; no se envían datos personales reales a documentación o chats.

### T0a. Identificar esquema e índices

Consultas exactas de reconocimiento, exclusivamente SELECT/SHOW, después de seleccionar
la base correcta en el cliente MySQL. No se presupone que la tabla se llame `cliente`.

```sql
SELECT DATABASE() AS base_actual, VERSION() AS version_mysql;
SHOW VARIABLES LIKE 'character_set%';
SHOW VARIABLES LIKE 'collation%';
SHOW VARIABLES LIKE 'time_zone';
SELECT NOW() AS hora_servidor, UTC_TIMESTAMP() AS hora_utc;
SHOW GRANTS FOR CURRENT_USER;
SHOW FULL TABLES;
SELECT TABLE_NAME, ENGINE, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME;
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY,
       CHARACTER_SET_NAME, COLLATION_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND (TABLE_NAME IN ('venta','detallev','articulo','ticket','nota','remision')
       OR COLUMN_NAME IN ('cli_id','tic_id','not_id','rem_id')
       OR TABLE_NAME LIKE '%clien%')
ORDER BY TABLE_NAME, ORDINAL_POSITION;
SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, CARDINALITY
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    SELECT TABLE_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND COLUMN_NAME IN ('cli_id','tic_id','not_id','rem_id','ven_id','art_id')
  )
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;
SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY TABLE_NAME, COLUMN_NAME;
SHOW FULL COLUMNS FROM venta;
SHOW INDEX FROM venta;
SHOW FULL COLUMNS FROM detallev;
SHOW INDEX FROM detallev;
SELECT ven_id, fecha, status, can_caj_id, can_rcc_id, tic_id, not_id, rem_id,
       caj_id, vnd_id, total, totalCompra
FROM venta ORDER BY ven_id DESC LIMIT 20;
SELECT ven_id, art_id, clave, descripcion, cantidad, precioCon, precioSin,
       importeCon, descTotal, precioCompra
FROM detallev ORDER BY ven_id DESC, art_id LIMIT 40;
```

Si una columna proporcionada no existe, parar esa consulta y corregir el diccionario,
no inferir una equivalencia. Las lecturas ORDER BY solo se ejecutan tras verificar el índice.
Para cliente/ticket/nota/remisión, generar SQL concreto desde sus nombres reales:

```sql
SELECT DISTINCT CONCAT('SHOW FULL COLUMNS FROM `',
       REPLACE(TABLE_NAME, '`', '``'), '`;') AS consulta_columnas,
       CONCAT('SHOW INDEX FROM `', REPLACE(TABLE_NAME, '`', '``'), '`;') AS consulta_indices
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND (COLUMN_NAME IN ('cli_id','tic_id','not_id','rem_id')
       OR TABLE_NAME LIKE '%clien%')
ORDER BY consulta_columnas;
SELECT CONCAT('SELECT * FROM `', REPLACE(TABLE_NAME, '`', '``'),
       '` LIMIT 5;') AS consulta_muestra
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    SELECT TABLE_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'cli_id'
  )
ORDER BY TABLE_NAME;
```

Ejecutar únicamente los SELECT/SHOW resultantes para las tablas identificadas, ver muestras
localmente y compartir solo estructura y ejemplos ficticios. Esto evita inventar nombre, teléfono,
correo, RFC o indicadores de cliente genérico. Si las tablas no tienen `cli_id`, parar y pedir
al proveedor el diccionario; no hacer una exploración masiva de datos personales.

### T0b. Resolver significado antes de codificar el adaptador

- [ ] Verificar las relaciones venta→ticket/nota/remisión→cliente; si una venta tiene más de un
  documento, establecer precedencia con evidencia. No usar UNION que cuente la venta tres veces.
- [ ] Identificar ids/indicador de público en general y variantes de nombre. Excluir por identidad
  documentada; el RFC genérico NO excluye por sí solo a un cliente que sí tiene nombre.
- [ ] Comparar al menos una venta vigente, una cancelada, una con descuento y una con cantidades
  fraccionarias contra su ticket. Documentar `status` y ambos campos de cancelación.
- [ ] Confirmar moneda, escala decimal, `total` frente a `totalCompra`, impuestos, descuentos,
  redondeos, devoluciones y si existen ventas con detalle vacío. No asumir que costo es venta.
- [ ] Buscar en los metadatos fecha de modificación/cancelación, secuencia de cambio o historial;
  confirmar si clientes y documentos se editan después y si `ven_id` se incrementa normalmente.
- [ ] Medir páginas por PK (100 ventas) en horario tranquilo, un JOIN por ids documentados y
  una consulta de ventana de 48 horas fuera del cobro. No hacer COUNT(*) repetido ni añadir índices.
- [ ] Preparar ejemplos anónimos esperados del contrato: ticket/nota/remisión para el mismo
  cliente, público, sin teléfono, cancelación y acentos latin1→UTF-8.

**TDD F0:** no se implementa código aquí. Los ejemplos fijan las pruebas rojas del adaptador
externo T4a; no se simula un ciclo rojo/verde para una consulta de reconocimiento.
**Archivos:** solo anexar resultados aprobados a este plan; ningún archivo de aplicación.
**Navegador F0:** en entorno de prueba existente, entrar a CRM y documentar lista, ficha,
dashboard y filtro Ocosingo como línea base; no enviar mensajes ni modificar datos.
**Paro:** privilegios mayores que lectura, índice PK ausente, esquema distinto, estado ambiguo,
importe no conciliable o consulta que afecte cobro. F1 puede probarse con datos ficticios;
ingesta real y F4 quedan bloqueadas hasta completar F0.

## 5. Modelo de datos propuesto: todo SICAR fuera del JSON

Usar el MISMO archivo de SQLite configurado por `DB_PATH`, con tablas nuevas y prefijo `sicar_`.
No un archivo subido ni una segunda copia de todas las ventas. `persistencia.js` proporcionará
una conexión/interfaz compartida de forma explícita; repositorio inyectable con SQLite `:memory:`
para pruebas. No importar `persistencia.js` desde pruebas puras porque abre la base al cargar.

| Tabla nueva | Clave y contenido mínimo |
| --- | --- |
| `sicar_esquema` | versión de migraciones aplicadas; migración transaccional idempotente. |
| `sicar_tiendas` | sucursal_id único, habilitada, versión de mapeo F0, última recepción y conciliación. |
| `sicar_llaves` | key_id, sucursal_id, SHA-256 del secreto aleatorio, creada/revocada, actor; nunca secreto. |
| `sicar_clientes` | PK (sucursal_id, cli_id TEXT), nombre, teléfono/celular crudos y normalizados, correo, RFC, revisión. |
| `sicar_vinculos` | misma PK de identidad, cliente_id nativo nullable, estado, versión, motivo, actor, fechas. |
| `sicar_decisiones` | historial inmutable de propuesta/confirmación/separación y bloqueo de nueva unión automática. |
| `sicar_ventas` | PK (sucursal_id, ven_id TEXT), cli_id, fecha local, estado normalizado, total_centavos, revisión, hash. |
| `sicar_detalles` | PK (sucursal_id, ven_id, art_id TEXT), clave, descripción, cantidad decimal, precios/importes decimales. |
| `sicar_envios` | UNIQUE(sucursal_id,batch_id), secuencia, hash, respuesta, conteos, fecha y resultado. |
| `sicar_intentos` | id, tienda/key_id conocido, batch_id validado, recibidos/aceptados/rechazados, bytes, código y hora. |

Índices: ventas por (sucursal_id,cli_id,estado,fecha,ven_id), vínculos por cliente_id,
teléfonos por normalizado+sucursal, envíos por tienda+secuencia, intentos por fecha.
FK compuestas cliente→venta→detalle; activar/verificar claves foráneas en conexión.
Nunca relacionar `art_id` con producto nativo ni `caj_id`/`vnd_id` con caja/vendedor nativo.
No persistir costo, saldo, crédito, monedero ni métodos de pago: no los necesita este CRM.

**Identidad de lectura:** cliente nativo conserva id numérico; cliente importado sin vínculo usa
`sicar:<sucursal_id>:<cli_id>`. En API v2 todo `cliente_ref` es texto, nativos `crm:<id>`.
Una identidad vinculada se agrupa con `crm:<id>`; la identidad fuente nunca desaparece.
Los nombres/datos importados no pisan el cliente nativo. La ficha conserva fuentes por separado.
No crear fichas nativas mínimas como atajo: también introducirían datos SICAR en el JSON.

**Primer paso de consulta:** ficha exclusivamente SICAR es de lectura; editar sus datos en SICAR.
Los contactos, embudo y asignación del CRM nativo conservan sus rutas y funcionan en fichas
`crm:<id>`. En fichas exclusivamente SICAR no se habilitan botones que terminarían usando
`Number('sicar:...')`. Ampliar esas acciones requiere la decisión Q8 y otra entrega explícita.

## 6. Contrato externo v1, independiente del código de la otra PC

### Autenticación y endpoints propuestos

- `POST /api/integraciones/sicar/v1/lotes`: única escritura de datos del agente.
- `GET /api/integraciones/sicar/v1/estado`: tienda de la llave, versión soportada,
  siguiente secuencia y última recepción; no devuelve clientes ni llaves.
- Header `Authorization: Bearer <key_id>.<secreto>`; secreto de 32 bytes aleatorios.
  Buscar key_id y comparar hash en tiempo constante con `node:crypto`; revocación inmediata.
- HTTPS con validación de certificado; nada de SQL, nombres de tabla o filtros ejecutables en JSON.
- La tienda siempre se obtiene de la llave. Rechazar `sucursal_id`, `tienda`, `caja_id` y
  propiedades no declaradas del cuerpo; jamás usar query para reemplazar identidad de tienda.
- Un emisor serial por tienda. Llave rotada conserva secuencia e identidad de tienda;
  no reinicia historia. No autenticar el agente con JWT de usuario.

### Ejemplo JSON normativo, con valores ficticios

```json
{
  "schema_version": 1,
  "mapping_version": "ocosingo-f0-v1",
  "batch_id": "e4db7dd8-91eb-478a-bf5c-071c7a549a12",
  "sequence": "1",
  "captured_at": "2026-10-13T18:00:00.000Z",
  "mode": "incremental",
  "window": {"from": "2026-10-11T12:00:00-06:00", "to": "2026-10-13T12:00:00-06:00"},
  "clientes": [
    {"cli_id": "123", "nombre": "Cliente de prueba", "telefono": "9191234567",
     "celular": null, "email": null, "rfc": "XAXX010101000"}
  ],
  "ventas": [
    {"ven_id": "4501", "cli_id": "123", "fecha_local": "2026-10-12T16:30:00",
     "timezone": "America/Mexico_City", "estado": "vigente", "moneda": "MXN",
     "total": "100.00", "detalle": [
       {"art_id": "81", "clave": "CABLE-1", "descripcion": "Cable de prueba",
        "cantidad": "2.0000", "precio_con": "50.0000", "precio_sin": "43.1034",
        "importe_con": "100.00", "descuento_total": "0.00"}
     ]}
  ]
}
```

Los campos/escala monetaria del adaptador dependen de F0. Esta muestra no afirma que `descTotal`
sea adicional a `importeCon`. El servidor no sumará dos veces descuentos: la fórmula exacta y
tolerancia se congelan en `mapping_version` con las muestras conciliadas. Si no se demuestra
esa fórmula, no aceptar compras reales ni inventar diferencias de ajuste.

### Validación y consistencia

- JSON UTF-8, sin compresión HTTP; máximo 1 MiB de cuerpo, 100 clientes, 100 ventas y
  1,000 líneas de detalle por lote; máximo 500 líneas por venta. Una venta viaja completa.
  Si una compra excede el límite, rechazar con referencia y parar esa compra: no truncar.
- Strings: nombre 250, teléfono/celular 40, correo 254, RFC 13, clave 100, descripción 500;
  rechazar exceso, no truncar. Confirmar contra F0 antes de congelar v1.
- Identificadores/secuencia como cadenas de enteros positivos sin signos ni ceros ambiguos;
  cli_id cero solo se admitiría si F0 demuestra que identifica a un cliente no genérico.
  Nunca convertir ids grandes a Number. Secuencia positiva monótona persistida en tienda.
- Dinero como string decimal sin exponentes ni separadores; convertir total a centavos enteros
  seguros en servidor, rechazar desbordamiento, NaN, negativos y precisión no pactada.
  Cantidades/precios decimales en representación exacta según F0, no parseFloat para validar.
  Estados permitidos: vigente/cancelada/excluida. Otros estados se rechazan.
- `excluida` es tombstone solo de ven_id previamente importado que ahora pertenece a público:
  no envía nombre/detalle del público, elimina su contribución y datos personales ya innecesarios.
  No importar ventas del público nuevas. Una ausencia en el lote nunca significa borrado.
- Cancelada se conserva marcada y no suma monto, frecuencia ni última compra. Para una venta
  ya conocida admite tombstone `{ven_id, estado:"cancelada"}`; una desconocida sin datos no se crea.
- Referencia de cliente debe existir en la misma tienda o en el mismo lote. Una venta puede
  cambiar de cliente por corrección de SICAR: recalcular ambas fichas y conservar auditoría.
- Rechazar lote completo si hay cualquier error: 422 con referencias/códigos sin datos personales,
  aceptados=0 y rechazados=total de entidades del lote. No confirmar parcialmente ni avanzar cursor.
- Upsert de cliente, cabecera, reemplazo completo del detalle y registro de recibo en UNA
  transacción SQLite. COMMIT antes del HTTP 200. Recalcular resúmenes desde estado vigente;
  no acumular deltas de importes que se dupliquen con reintentos.
- Mismo (tienda,batch_id) y mismo hash SHA-256 de bytes UTF-8: devolver respuesta original,
  sin reescribir entidades. Mismo id y bytes distintos: 409. El agente conserva bytes exactos
  hasta ACK; después de 422 corrige y genera otro batch_id con la misma secuencia pendiente.
- Lote nuevo debe tener la siguiente secuencia de la tienda; hueco o secuencia vieja: 409
  con siguiente esperada. Reintento idéntico se resuelve antes de validar secuencia.
  Revisión de fila = secuencia aceptada. No usar reloj del equipo como orden de cambios.
- 200: `{schema_version:1,batch_id,sequence,aceptados:{clientes,ventas},rechazados:0,
  next_sequence,received_at}`. 400 contrato, 401 llave, 409 conflicto, 413 tamaño,
  422 datos, 429 ritmo, 503 mantenimiento/disco/transacción. Versiones no admitidas: 400
  `VERSION_NO_SOPORTADA`, sin intentar interpretar como otra versión.
- Reintentos de red/429/503 con espera 5, 15, 30, 60, 300 segundos y variación aleatoria;
  detener automáticamente ante 401, 409 de identidad o 422 hasta corrección.
- Máximo 1 lote en vuelo por tienda y 12 solicitudes/minuto por llave; limitar también intentos
  sin llave por origen. Parámetros técnicos ajustables tras medir, nunca envíos en paralelo.
- Auditoría de cada intento: recibido, tienda si se conoce, key_id, batch_id, bytes, conteos,
  código, duración. Sin cuerpos, nombres, teléfonos, RFC ni secreto; rechazados por parser
  registran conteo desconocido, no un cero engañoso. Duplicados también dejan intento.
- Conservar recibos idempotentes durante toda la carga y operación inicial; medir crecimiento.
  No purgar unilateralmente: política de retención Q7. El estado compacto de secuencia impide
  reaplicar lotes antiguos incluso si una política futura archiva recibos.

### Extracción, cancelaciones y carga sobre SICAR

Antes de recorrer ventas, paginar también TODOS los clientes con nombre por su PK confirmada
en F0, aunque nunca hayan comprado. Excluir público y cargar clientes sin compras con totales cero.
Si cliente carece de fecha de modificación indexada, releer su catálogo por PK en una pasada
nocturna acotada; no esperar una compra nueva para detectar cambios de teléfono/nombre.
El SQL de esa pasada se fija tras conocer tabla y columnas, sin inventarlas en este plan.

1. Carga histórica por `ven_id > ultimo_id ORDER BY ven_id LIMIT 100`, con límite superior
   capturado al inicio. Leer documentos/clientes/detalles por conjuntos de ids indexados,
   sin consulta por cada artículo ni traer todo el catálogo. Filtrar público antes de enviar.
2. Una conexión, páginas de 100, pausa inicial de 1 segundo y solo fuera de horas de cobro
   para histórico. Medir tiempo de consultas y latencia de caja antes/durante el piloto.
3. Ciclo propuesto cada 5 minutos para nuevas ventas. Releer las últimas 48 horas completas
   incluyendo canceladas y reemplazar detalle, aun cuando ya se enviaron.
4. Como `fecha` no tiene índice, NO paginar `WHERE fecha >= ...` con OFFSET: repetiría escaneos.
   Mantener índice local del agente (ven_id,fecha) durante el histórico y releer por PK los ids
   de la ventana; revisar también ids nuevos. Validar con barrido por PK programado las fechas
   corregidas y ventas insertadas con fecha antigua. Esa caché vive en la PC de tienda.
5. Si no puede mantener esa caché, una lectura de ventana escanea hasta 92 mil ventas por ciclo:
   12/hora serían hasta 1.104 millones de filas examinadas/hora, antes de JOINs. No habilitar
   ese modo en horario de caja sin medición y autorización del responsable de SICAR.
6. **48 horas por fecha de venta NO detectan cancelar hoy un ticket de 2015.** Si F0 encuentra
   modificación indexada usarla además de la ventana; si no, conciliación gradual por PK de
   todas las ventas identificadas importadas, propuesta semanal fuera de horario (Q5).
   Registrar cobertura y mostrar «conciliado hasta»; no prometer tiempo real.
7. Ventas y detalles pueden cambiar mientras se leen: F0 confirma motor de tablas. Con InnoDB,
   el mantenedor define lectura consistente de cada página sin bloqueos; con motores sin snapshot,
   releer cabecera/detalle y detectar variaciones, reintentando después. No bloquear cajas.
8. Presupuesto inicial: si una consulta supera 200 ms repetidamente, bajar página; si supera
   1 segundo o caja aumenta más de 10% su latencia base, pausar agente. Son límites propuestos
   para piloto, no mediciones ya realizadas. No añadir índices ni cambiar MySQL en este trabajo.

## 7. Vínculos por teléfono y convivencia con Excel

Reutilizar `normalizarTelefono` de `clientes.js` para números mexicanos confirmados de 10 dígitos;
no unir por números vacíos/cortos, nombre, correo, RFC ni clave Excel. Prefijos internacionales
ambiguos no deben coincidir automáticamente solo por los últimos 10 dígitos: revisión Q2/F0.

Una coincidencia única con cliente nativo distinto de id 0 crea vínculo **pendiente** y suma las
compras a esa persona con aviso, como decidió Victor; no esperar confirmación para ligarlas.
Sin coincidencia nace ficha externa nueva y consultable, incluso sin teléfono.
Múltiples candidatos o dos teléfonos que apuntan a personas distintas: propuesta Q2,
sin elección automática; bloquear resolución de esa identidad, conservar la compra en su fuente.

Confirmar cambia únicamente estado/actor/fecha. Deshacer quita cliente_id del vínculo y devuelve
las compras a su ficha externa, sin borrar ni modificar ventas nativas, contactos o demandas.
Guardar decisión de separación para que el siguiente lote no una de nuevo por el mismo teléfono.
Usar `expected_version` para impedir que dos revisores se pisen (409). Cambio de teléfono fuente
no mueve silenciosamente una unión confirmada; generar aviso y conservar decisión hasta revisión.

Excel: reutilizar únicamente normalización validada y su experiencia de previsualización;
NO usar `aplicarImportacion`, crearCliente o actualizarCliente para ingesta.
Propuesta Q6: al activar agente en una tienda, bloquear importar **clientes** por Excel para ella,
tanto previsualizar como aplicar; artículos/proveedores y exportación no cambian.
Los clientes Excel previos se consideran nativos y entran al matching por teléfono con aviso.
Nunca asumir que `clave` de Excel es `cli_id`; duplicados históricos van a la cola de revisión.

Al crear después un cliente nativo por pantalla o Radar que coincide con una ficha externa,
volver a ejecutar el mismo resolutor de vínculos y mostrar el mismo aviso, sin copiar fuente al JSON.
No trasladar una demanda a otra sucursal ni considerar una compra SICAR como demanda recuperada.
La creación nativa conserva consentimiento y reglas de teléfono ya existentes; esta integración
no autoriza envíos de WhatsApp, correo ni campañas a clientes importados.

## 8. CRM, alcance y permisos propuestos

### Lectura bajo demanda

Nueva API de lectura v2, conservando la API nativa actual para sus consumidores existentes:

- `GET /api/crm/v2/clientes?cursor=...&limit=50&buscar=...`: items resumidos y cursor opaco;
  máximo 100. Filtros y totales se calculan en servidor para todo el conjunto autorizado.
- `GET /api/crm/v2/clientes/:ref`: ficha, monto_centavos, numero_compras, ultima_compra,
  score, segmento, ya_compro, fuentes visibles y aviso de vínculo.
- `GET /api/crm/v2/clientes/:ref/compras?cursor=...&limit=50`: cabeceras combinadas,
  orden (fecha DESC, fuente, tienda, id); máximo 100 y cursor firmado/validado.
- `GET /api/crm/v2/compras/:ref`: detalle completo; referencia `sicar:1:4501` o `pos:900`.
- `GET /api/crm/v2/resumen`: tarjetas, sucursales y ranking con desglose por fuente.

La búsqueda, segmentos y totales no deben operar únicamente sobre la página visible.
No incluir `compras:[]` para fingir que una ficha no compró. Componentes usan resúmenes explícitos.
Agregación SQL por clientes visibles, en bloques acotados; detalles solo al abrir compra.
Ventas nativas se calculan desde POS como hoy, con centavos para combinar montos.
Mantener `score = round(min(100,min(40,total/500)+min(30,frecuencia*10)+recencia*0.3))`,
con `recencia=max(0,100-días)`; segmentos <=30 activo, <=90 en_riesgo, resto inactivo.
Con fecha fija, una compra vigente hoy de $100 da score 40 y segmento activo; cancelarla
sin otras compras da monto 0, frecuencia 0, última null y score 0. Reusar reglas de crm.js.

### Alcance: autorización primero, filtro después

- Token y permisos determinan conjunto autorizado. `sucursal_id` query solo lo reduce.
  Por ref/id ignorar selector al autorizar; usar `resolverAlcanceAutorizado`.
- Sin alcance global, ninguna respuesta de compras, totales, score, avisos o búsquedas puede
  revelar compras de otra tienda. Aplicar filtro antes de calcular métricas, no al renderizar.
- Los clientes nativos mantienen su sucursal y vendedor. Una unión no concede acceso a su
  ficha nativa desde otra tienda. Para vínculo cruzado pendiente, mostrar en tienda fuente
  solamente ficha/datos SICAR propios y aviso genérico; resolución global (Q3).
- Q3 decide si después de confirmar una persona puede verse desde ambas tiendas y qué
  métricas mostrar. Mientras no esté resuelta, no liberar caso multitienda a producción.
- El código CRM actual limita por sucursal, no solo por vendedor; no inventar un nuevo permiso
  «solo mi cartera». Preservar vendedor asignado y su validación de pertenencia a sucursal.
- SICAR `vnd_id` no asigna un vendedor de CORPUNISOUND. Nuevos externos quedan sin asignar.
  Ranking comercial por vendedor con compras SICAR depende de Q4; sin respuesta no alterarlo.
- Gerencia: usar última compra combinada de la cartera nativa autorizada para generar y resolver
  tareas; no cambiar progreso, meta ni sugerencia monetaria. Radar mantiene su recuperación POS
  y sus ids nativos; testear que enlace por teléfono no cambia demanda ni consentimiento.
- Postventa automática y apartados existentes siguen exclusivamente POS en esta primera entrega.
  No reutilizar `venta_id` numérico para contactos SICAR. El historial sí muestra sus compras.

### Permisos

Crear módulo `sicar` en `MODULOS_SISTEMA` y en guard `MODULOS_QUE_REQUIEREN_PERMISOS`.
Registrar `administrar_llaves_sicar`, `ver_sincronizacion_sicar`, `resolver_vinculos_sicar`
y `ver_clientes_sicar` en `backend/permisosCatalogo.js`.
Rutas humanas requieren login, permiso propio y alcance; datos nativos mantienen controles actuales.
Administrador recibe catálogo reconciliado. Q1 decide delegaciones; no conceder a gerentes/cajeros
al sembrar roles nuevos ni reconciliar roles existentes. Probar ambas situaciones.

Administración propuesta dentro de CRM, sin navegación global nueva:
`GET/POST /api/sicar/llaves`, `POST /api/sicar/llaves/:id/revocar`,
`GET /api/sicar/envios`, `GET /api/sicar/vinculos`,
`POST /api/sicar/vinculos/:sucursal/:cliId/resolver`.
Crear llave recibe tienda validada contra alcance; solo el endpoint administrativo admite ese campo.
El secreto se muestra una vez, nunca se lista; confirmar/deshacer exige motivo y expected_version.
Probar permiso vecino sin el requerido, no solamente un rol vacío.

## 9. Disco, memoria y respaldo

**Estimación, no medición:** 92,000 ventas totales de Ocosingo; porcentaje identificado desconocido.
Hipótesis de dimensionamiento: 5 artículos por venta, 2 KB por cliente con índices,
0.5 KB cabecera y 0.4 KB por detalle; 50% adicional para índices/holgura.
Fórmula aproximada: `1.5 × (C×2 KB + V×0.5 KB + L×0.4 KB)`, más recibos y auditoría.

| Escenario hipotético por tienda | Volumen aproximado |
| --- | --- |
| 10% identificado: C=3,000; V=9,200; L=46,000 | 44 MB, más 5–15 MB iniciales de auditoría/recibos. |
| 30% identificado: C=8,000; V=27,600; L=138,000 | 128 MB, más auditoría/recibos. |
| 100% conservador: C=20,000; V=92,000; L=460,000 | 405 MB, más auditoría/recibos. |

Cuatro tiendas similares al 30% ya serían ~512 MB adicionales antes de base actual, journals,
crecimiento y respaldo. No asegurar que caben en 1 GB. F0 mide conteos identificados y longitud
real, F1 mide páginas SQLite y disco libre. Guardar solo fuentes necesarias, no payloads duplicados.
1,152 envíos diarios a cuatro tiendas cada cinco minutos × 0.5 KB ≈ 0.58 MB/día solo recibos,
antes de índices e intentos: la retención importa aun si hay pocas ventas.

Presupuesto propuesto de piloto: >=300 MB libres antes de arrancar histórico; pausar ingesta
si libres <250 MB o el uso total proyectado supera 750 MB. Reservar margen para journal/WAL y
restauración; no borrar respaldos para hacer lugar. Medir también máximo temporal, no solo archivo.
Si no cabe, reportar Q7 y no habilitar siguiente tienda; no cambiar Render ni recortar historia solo.

Memoria: lote de 1 MiB puede consumir 4–10 MiB al parsear/validar; una sola ingesta activa global
evita cuatro copias simultáneas. Cache SQLite propuesta 8 MiB, página CRM de 50, chunk respaldo
de hasta 2 MiB. Meta inicial: incremento RSS <40 MiB en ingesta/consulta, <64 MiB en respaldo,
sin contar memoria base existente. Medir p95 y event-loop: consultas/transacciones ordinarias
<100 ms; detener expansión si se exceden repetidamente. Nunca materializar histórico completo.

**Sí entran a Drive:** clientes, compras, detalles, vínculos/decisiones, configuración y recibos.
Aunque ventas puedan releerse, SICAR puede cambiar y las decisiones humanas no son reconstruibles.
No basta respaldar solo el JSON. Llaves respaldadas solo como metadatos/hash; una recuperación
en servidor nuevo exige emitir llaves nuevas. Restaurar nunca reactiva llaves ya revocadas.

Propuesta de formato 3: foto JSON nativa + manifiesto de chunks SICAR cifrados en Drive, con
snapshot_id, versión, orden, conteos y SHA-256 de cada chunk. Reusar empaquetar/desempaquetar
por chunk, nunca armar un único JSON con todo SICAR. Ningún temporal en disco de Render.
Tomar foto nativa y snapshot de lectura SQLite coherentes antes del primer await; usar conexión
lectora separada y evaluar WAL con prueba de concurrencia. No cambiar journal global a ciegas.
Subir chunks desde buffers acotados y publicar manifiesto final solo tras verificar todos.
Abandonar snapshot si supera 60 s o crecimiento WAL supera 32 MB; marcar fallo, liberar lector,
limpiar huérfanos en Drive mediante índice del intento. El respaldo JSON nativo no debe dejar de
ejecutarse por fallo SICAR: estado visible «parcial», nunca «completo verificado».

Restauración: validar todos los chunks antes de afectar tablas vivas; usar tablas de preparación
en el mismo SQLite, con reserva de disco calculada. Mantenimiento bloquea también ingesta.
Respaldar previo, reemplazar tablas y `estado` en una transacción, luego actualizar DB en memoria;
si falla antes de COMMIT, rollback completo. No responder éxito antes del guardado.
No exponer lecturas mezcladas durante restauración; reinicio debe cargar mismo snapshot.
Conservar revocaciones actuales y revocar todas las llaves recuperadas en instalación nueva.
Formato 2 en instalación con SICAR requiere confirmación específica y reconciliación de enlaces:
no dejar ids nativos apuntando a otra persona después de restaurar una foto antigua.
Propuesta segura: bloquear esa restauración ordinaria hasta un procedimiento compatible;
formato 2 sigue utilizable en bases sin SICAR. Testear sin ejecutar restauración real.

## 10. Fases de implementación futuras y contratos entre tareas

Regla TDD para cada tarea de código: (1) escribir prueba con las aserciones indicadas;
(2) ejecutar y comprobar fallo por el comportamiento ausente, no por entorno roto;
(3) implementar mínimo; (4) repetir comando y regresiones; (5) revisión y navegador.
No se incluyen commits automáticos. Si faltan herramientas ya instaladas, detener y reportar.

**Comando base**, sustituyendo únicamente el archivo declarado por cada tarea:

```powershell
node --preserve-symlinks --preserve-symlinks-main --test backend/sicarRepositorio.test.js
```

Fixtures propios con `prepararDB()`; helpers existentes solo `construirDBPrueba` y `sembrarCuentas`.
Pruebas HTTP fijan DB_PATH desechable ANTES de require(server), deshabilitan Sentry e integraciones
reales, usan puerto efímero y cierran conexiones. Nunca pruebas contra `datos.sqlite` del negocio.

### F1 — Almacén, llave e ingesta aislada; sin carga real todavía

#### T1a. Tablas y transacciones

**Crear propuestos:** `backend/sicarRepositorio.js`, `backend/sicarRepositorio.test.js`.
**Modificar:** `backend/persistencia.js` exclusivamente para interfaz inyectable de conexión
y transacción requerida. **Prohibido:** todo archivo fuera de esta lista, especialmente POS/cajas.
**Interfaz nueva:** `crearRepositorioSicar(sqlite)` retorna repositorio;
`repo.aplicarLote({sucursalId, lote, hash})` retorna recibo; `repo.estado(sucursalId)` retorna cursor.

- [ ] Pruebas rojas: mismo cli_id/ven_id en tiendas 1 y 2 son distintos; FK impide detalle huérfano;
  repetir lote deja 1 compra/2 líneas; reemplazar detalle de 2 a 1 elimina sobrante; cancelar da 0
  compras vigentes; fallo entre cabecera y detalle deja todas las tablas como antes.
- [ ] Probar reinicio, migración dos veces y JSON guardado idéntico antes/después de ingesta.
- [ ] Ejecutar comando base para `sicarRepositorio.test.js`, observar rojo, implementar, verde.
- [ ] Parar si exige cambiar estado JSON, nuevas dependencias o datos de negocio no descritos.

#### T1b. HTTP, llaves, límites y aislamiento de dinero

**Crear propuestos:** `backend/sicarIngesta.js`, `backend/sicarRutas.js`,
`backend/sicarIngesta.test.js`, `backend/sicarRutas.test.js`, `backend/sicarAislamiento.test.js`,
`src/SicarAdministracion.jsx`.
**Modificar:** `backend/server.js`, `backend/permisosCatalogo.js`, `backend/validarPermisos.js`,
`backend/roles.js`, `backend/instrument.js`, `src/CRM.jsx` (entrada al panel).
**Prohibido:** ventas/cortes/cajas/reportes, paquetes/lockfiles y cualquier otro archivo.
**Interfaces nuevas:** `validarLoteSicar(body, mapping)` produce lote normalizado o error tipado;
`registrarRutasSicar(app, {repo, autenticarUsuario, resolverPermisos, resolverAlcanceAutorizado})`.
Adaptar argumentos a funciones reales de server, no inventar helpers de autenticación existentes.

- [ ] Rojo: llave inválida/revocada 401; tienda falsa 400; 1 MiB+1 byte 413 ANTES del parser global;
  array excesivo 422; permiso vecino 403; Administrador sí, gerente recién sembrado no.
- [ ] Rojo: mismo lote 200 sin duplicar; mismo id/cuerpo distinto 409; secuencia fuera de orden 409;
  caída del guardado no devuelve 200; POST agente no ejecuta guardar(DB); mantenimiento 503.
- [ ] Rojo: dinero mal formado, desbordado, descuento incongruente, estado desconocido y SQL
  en lugar de estructura se rechazan sin mutación. Acentos sobreviven transporte UTF-8.
- [ ] Rojo privacidad: llaves/cuerpos ausentes de logs, Sentry, listas y auditoría; secreto solo
  en respuesta de creación. Auditoría cubre rechazo de parser sin volcar cuerpo.
- [ ] Rojo de aislamiento: fixture nativo con venta en caja administrativa sin caja_id, otra fiscal,
  monedero y corte; capturar `calcularCorteEnCurso(DB,1,caja.id)` para ambas y
  `reporteUtilidad(DB,{},alcance)`. Ingerir/cancelar/reintentar SICAR por HTTP y exigir igualdad
  profunda de esos resultados, DB.pos, DB.inventario y saldos/monederos de clientes existentes.
  Usar `esDeEstaCaja` real; además comprobar fuente de compras CRM nunca alimenta corte.
- [ ] Ejecutar comando base por cada uno de los tres archivos nuevos, rojo→verde;
  regresión `cajas.test.js`, `reportes.test.js`, `rolesReconciliacion.test.js`.
- [ ] Navegador F1: Administrador abre panel, crea llave ficticia Ocosingo, copia una vez,
  refresca y ya no ve secreto; envía fixture desde cliente HTTP de pruebas, ve conteos/fecha;
  revoca y reintento da 401. Gerente sin permisos no ve panel y HTTP da 403.
  Abrir corte y utilidad de prueba antes/después: cifras iguales.
- [ ] Parar si orden de middleware elude mantenimiento/límites o si aparece SICAR dentro de DB.

#### T1c. Respaldo real de las tablas, antes de habilitar una tienda

**Crear propuestos:** `backend/sicarRespaldo.js`, `backend/sicarRespaldo.test.js`.
**Modificar:** `backend/respaldos.js`, `backend/persistencia.js`, `backend/server.js`;
`src/SicarAdministracion.jsx` para estado de cobertura.
**Prohibido:** otros archivos, especialmente Drive/Render salvo nueva autorización justificada.
**Interfaz nueva:** `crearSnapshotSicar(repo, drive, contexto)` retorna manifiesto verificado;
`prepararRestauracionSicar(repo, drive, manifiesto)` valida y prepara sin sustituir tablas vivas.

- [ ] Rojo: respaldo/restauración recupera compra, detalle, enlace deshecho y recibo idempotente;
  chunk faltante/corrupto, disco corto o Drive fallido no cambia base ni declara respaldo completo.
- [ ] Rojo: snapshot consistente mientras entra lote; límite de memoria y WAL; no llamadas a
  escritura de archivos temporales; restauración con compra nueva concurrente responde 503.
- [ ] Rojo: revocada no revive; formato 2 con SICAR bloqueado explícitamente; sin SICAR conserva
  compatibilidad; caída antes/después de COMMIT y reinicio no mezcla fuentes.
- [ ] Comando base con `sicarRespaldo.test.js`; regresiones `respaldos.test.js`,
  `respaldosRutas.test.js`, `respaldosVersionAnterior.test.js`, `arranquePersistencia.test.js`.
- [ ] Navegador F1c, solo entorno desechable: estado parcial al simular Drive caído; recuperar,
  respaldar, cambiar fixture, restaurar y abrir ficha; verificar enlace, detalle y llave revocada.
- [ ] Parar si requiere temporal local, no hay reserva para staging, no puede limitar snapshot
  o los mecanismos actuales de restauración impiden atomicidad. No liberar F1 real sin resolverlo.

### F2 — Enlaces reversibles y conflictos visibles

#### T2a. Resolutor y cola de revisión

**Crear propuestos:** `backend/sicarVinculos.js`, `backend/sicarVinculos.test.js`,
`src/SicarVinculos.jsx`.
**Modificar:** `backend/sicarRepositorio.js`, `backend/sicarRutas.js`, `backend/server.js`,
`src/SicarAdministracion.jsx`.
**Prohibido:** dinero, mutar datos nativos por ingesta y cualquier archivo no listado.
**Interfaz nueva:** `resolverVinculosSicar(repo, clientesNativos, identidades)`;
`resolverDecisionSicar(repo, identidad, {accion, expected_version, motivo}, actor, alcance)`.

- [ ] Rojo: coincidencia única crea pendiente y agrupa; no coincidencia crea ref externa;
  id 0, RFC genérico, mismo nombre, teléfono vacío/corto nunca unen; cli_id se limita a tienda.
- [ ] Rojo: lote solo de clientes sin ventas crea fichas consultables con monto/frecuencia cero
  y última compra null; relectura nocturna actualiza fuente sin borrar decisiones humanas.
- [ ] Rojo: confirmar conserva compras; deshacer devuelve exactamente compras a ficha externa;
  siguiente lote no vuelve a unir; dos revisores con misma versión producen 200 y 409.
- [ ] Rojo: campo actualizado no cambia enlace confirmado; conflicto de teléfonos queda visible;
  compra corregida de cliente se mueve una sola vez y se recalculan ambas fichas.
- [ ] Rojo: crear cliente nativo manual/Radar después del importado ejecuta el mismo matching,
  sin duplicar persona en lectura ni mover demandas. Guardar nativo y decisión debe ser atómico:
  persistir estado y tablas compartidas antes de responder; ante error restaurar memoria previa.
- [ ] Comando base con `sicarVinculos.test.js`; regresiones `clientesDuplicados.test.js`,
  `clientesListaBlanca.test.js`, `clientesAlcanceVendedor.test.js`, `radarVinculoCrm.test.js`.
- [ ] Navegador F2: dos fixtures con mismo teléfono, ver aviso, confirmar; otro caso deshacer,
  reenviar lote y comprobar separación. Gerente fuera de alcance obtiene 404 sin nombres ajenos.
- [ ] Parar caso ambiguo o multitienda hasta Q2/Q3; no convertir recomendación en política.

#### T2b. Exclusión de importación Excel para tienda activada

**Modificar:** `backend/migracion.js`, `backend/server.js`, `backend/migracion.test.js`;
**crear propuesto:** `backend/sicarMigracion.test.js`. Otros archivos prohibidos.
Agregar guard de clientes por tienda habilitada, compartido por preview/aplicar; dejar
activación de la tienda y precondición bajo repositorio, sin copiar configuración al JSON.

- [ ] Rojo: clientes Excel de Ocosingo habilitado rechazados por ambas rutas; tienda no habilitada
  mantiene comportamiento; artículos/proveedores/exportar siguen igual; clave no enlaza cli_id.
- [ ] Comando base con `sicarMigracion.test.js` y `migracion.test.js`, rojo→verde.
- [ ] Navegador F2b: abrir importador existente, intentar clientes en tienda habilitada y ver
  explicación; probar previsualización de artículos sin aplicar a datos reales.
- [ ] Parar hasta decisión Q6; no bloquear unilateralmente un flujo previo del negocio.

### F3 — CRM combinado, paginado y con alcance comprobado

#### T3a. Servicio de consulta y consumidores

**Crear propuestos:** `backend/crmFuentes.js`, `backend/crmSicar.test.js`,
`backend/crmSicarRutas.test.js`.
**Modificar:** `backend/crm.js`, `backend/server.js`, `backend/sicarRepositorio.js`,
`backend/gerenteVentas.js`, `backend/gerenteVentas.test.js`.
**Prohibido:** cálculo de avance/metas monetarias, radar de recuperación, POS y otros archivos.
**Interfaz nueva:** `crearConsultasCRM(DB, repo)` retorna `listar(contexto, filtros)`,
`ficha(contexto, ref)`, `compras(contexto, ref, pagina)`, `detalle(contexto, ref)`,
`resumen(contexto, filtros)` y `ultimasCompras(contexto, clienteIds)`.
`contexto` contiene alcance autorizado y permiso SICAR; no se acepta desde cuerpo HTTP.
Funciones nativas de crm.js conservan firmas; extraer/exportar cálculo de score común si hace
falta. Gerencia recibe proveedor opcional explícito; ruta lo inyecta, no singleton SQLite global.

- [ ] Rojo: $100 POS + $200 SICAR vigente + $90 SICAR cancelada = $300 y 2 compras;
  refs de venta con mismo número no colisionan; detalle conserva descripción sin producto nativo.
- [ ] Rojo: paginar 101 clientes/ventas sin repetir ni perder ids; totales permanecen globales
  al pasar de página; score 40 para compra de $100 hoy; fronteras 30/31/90/91 días con reloj fijo.
- [ ] Rojo: cancelar última compra retrocede última fecha y cambia segmento; sin compras es inactivo;
  segmento de tareas Gerencia coincide con CRM, pero `calcularProgreso` y `sugerirMeta` no cambian.
- [ ] Rojo: id en texto, selector ajeno y `todas` no amplían token; administrador abre ficha de
  Ocosingo con Yajalón seleccionado; consultas por ref sin permiso devuelven 404/403 sin filtrar PII.
- [ ] Rojo: score/total/listado/detalle no filtran información ajena por vínculo; vendedor asignado
  no se sustituye por vnd_id; cliente sin vendedor no desaparece de totales de sucursal.
- [ ] Comando base con `crmSicar.test.js`, `crmSicarRutas.test.js`, `gerenteVentas.test.js`;
  regresiones `crmAgregados.test.js`, `crmEstadoCliente.test.js`, `filtradoDatos.test.js`,
  `radarVinculoCrm.test.js`, `radarDemandaRutas.test.js`, `clientesAlcanceVendedor.test.js`.
- [ ] Parar agregados entre tiendas/ranking hasta Q3/Q4. Nunca ofrecer cifras con semántica implícita.

#### T3b. Pantalla CRM y prueba de uso completa

**Crear propuestos:** `src/CRMComprasSicar.jsx`, `src/CRMListaClientes.jsx`.
**Modificar:** `src/CRM.jsx`; **prohibido:** todos los demás archivos.
Componentes reciben resúmenes, refs y callbacks; usan `apiFetch` existente y no guardan llave
de agente. Cambiar uso de Number solo en rutas/ref nuevas; conservar ids numéricos nativos.

- [ ] Primero fijar rojo de contrato en `crmSicarRutas.test.js` (T3a): respuesta tiene monto,
  frecuencia, última compra y fuente aunque no tenga arreglo completo de compras.
- [ ] Implementar lista paginada, búsqueda servidor, ficha y detalle bajo demanda; tarjetas desde
  resumen, no suma de página; aviso de unión y marca «SICAR, tienda X», estado cancelada visible.
- [ ] Compras canceladas se muestran con importe original y «No suma al total»; nuevas fichas
  externas son consultables sin teléfono y no simulan controles nativos que no funcionan.
- [ ] Verificación: comando base `crmSicarRutas.test.js` y ESLint local de archivos tocados.
  No añadir un runner de frontend. Probar interfaz real en navegador con fixtures desechables.
- [ ] Navegador F3: buscar con acentos; abrir cliente solo SICAR y cliente unido; comprobar
  $300/2 compras del fixture; abrir artículo; pasar páginas, filtrar tienda y volver; cancelar
  fuente, refrescar y comprobar total/segmento; deshacer unión y verificar ambas fichas.
- [ ] Con dos cuentas, comprobar permiso y tienda; abrir URL directa ajena; con Administrador
  cambiar encabezado a otra tienda y abrir ficha autorizada. Revisar consola y Network.
- [ ] Abrir Radar y crear demanda ficticia con consentimiento, comprobar vendedor y vínculo;
  abrir Gerencia y comprobar última compra, luego corte/utilidad sin cambios.
- [ ] Parar ante cifra discordante, fuga, llamada sin límite o botón sobre ref externa que falle.

### F4 — Entrega del contrato y aceptación del agente externo

#### T4a. Conformidad y piloto Ocosingo

**Archivos del repo propuestos:** crear `backend/sicarContrato.test.js`; modificar únicamente
este plan con versión final F0. **Agente:** cambios en la otra PC a cargo de su mantenedor,
sin inventar nombres de archivos ni dependencias disponibles allí.

- [ ] Entregar contrato v1 y fixtures F0, incluidos bytes exactos para reintento, 422, cancelación,
  corrección de detalle/cliente, factura/documentos múltiples y exclusión de público.
- [ ] Rojo local: cliente de prueba del contrato no pasa versión/moneda/estado incorrectos;
  fixture válido produce recibo previsto, repetición no duplica, reinicio retoma secuencia.
- [ ] Rojo en agente externo: no puede escribir MySQL; lectura latin1 sale UTF-8; desconexión
  tras COMMIT antes de ACK se recupera; solo avanza cursor con ACK; una ventana de 48 h
  detecta cancelación reciente; ticket viejo cancelado aparece por conciliación adicional.
- [ ] Verde local: comando base con `sicarContrato.test.js` y `sicarIngesta.test.js`.
  El mantenedor documenta su comando `node --test` y resultados; no asumirlos ejecutados aquí.
- [ ] Seguridad de tienda documentada: usuario MySQL exclusivamente SELECT sobre tablas necesarias,
  limitado a localhost, sin GRANT/FILE/DDL/escritura; Node y MySQL en mismo servidor.
  No abrir 3306, no cuenta root; credencial MySQL y llave HTTPS en configuración local con ACL
  del usuario del servicio, fuera del repo/logs. `SHOW GRANTS` debe demostrarlo. Aprovisionar
  usuario excede SELECT/SHOW y lo hace el responsable de tienda, no este trabajo.
- [ ] Navegador F4: en staging ver ingreso de un cliente real de prueba autorizado y compra,
  comparar ticket manualmente; desconectar agente y observar fecha de actualización antigua;
  reconectar, reenviar y verificar que no duplica. Revocar llave de prueba y comprobar paro.
- [ ] Piloto gradual: primero muestra pequeña fuera de horario, conciliar 20 compras nombradas
  (o todas si hay menos), luego histórico por páginas, luego incremental. Verificar exclusión
  de público, backup restaurable, disco, latencia y cancelaciones antes de habilitar otra tienda.
- [ ] Parar ante cualquier diferencia de centavos inexplicada, falta de detalle, duplicado,
  impacto en caja, permisos excesivos, respaldo parcial o proyección de disco fuera de presupuesto.
  No activar Yajalón, San Cristóbal o Palenque sin repetir F0, prueba y llave propia.

## 11. Verificación de entrega futura y reversibilidad

- Revisión independiente de cambios autorizados, evidencias rojo/verde y pruebas de navegador;
  una captura de pantalla no sustituye comparación de totales y respuestas HTTP.
- ESLint con instalación existente, sin descargar paquetes:
  `node node_modules/eslint/bin/eslint.js <rutas-explícitas-tocadas>` desde raíz;
  si ese binario no existe, detener y reportar, no instalar.
- Revisión de líneas con PowerShell sobre rutas explícitas:

```powershell
$rutas = @('backend/sicarRepositorio.js', 'backend/sicarIngesta.js', 'src/CRM.jsx')
foreach ($ruta in $rutas) {
  $numero = 0
  Get-Content -LiteralPath $ruta -Encoding utf8 | ForEach-Object {
    $numero++
    if ($_.Length -gt 200) { Write-Output "${ruta}:${numero}: $($_.Length) caracteres" }
  }
}
```

Expandir `$rutas` a todos los archivos tocados; resolver líneas nuevas/tocadas >200 y reportar
preexistentes fuera del diff. La suite completa y commits quedan a Claude según instrucciones
del repo; nunca ejecutar suite completa desde un worktree para esta entrega.

Reversibilidad de operación: revocar llave/pausar tienda detiene entradas sin borrar historial.
Deshabilitar vista SICAR vuelve a lectura nativa sin alterar POS. No hacer DROP ni borrar enlaces.
Un rollback de aplicación debe conservar soporte del respaldo formato 3 mientras existan esos
respaldos: no retroceder a un lector que declara éxito omitiendo tablas SICAR.

## 12. Preguntas abiertas para Victor y bloqueos correspondientes

Estas preguntas no reabren agente, alcance de importación ni regla de unión por teléfono ya decididos.

1. **Q1 — Responsables:** ¿quién administra llaves y revisa uniones?
   Opciones: solo Administrador; Administrador para llaves y gerente para uniones de su tienda.
   Recomendación: segunda, con uniones entre tiendas solo Administrador. Bloquea delegación F1/F2;
   mientras tanto construir pruebas sin conceder permisos a roles operativos.
2. **Q2 — Teléfono compartido o ambiguo:** si hay varios clientes con ese teléfono, ¿cómo resolver?
   Opciones: mantener ficha externa y revisión humana; asignar al cliente elegido por un responsable
   antes de mostrarla agrupada. Recomendación: conservar ficha externa visible y cola de revisión,
   sin escoger el primero. Para teléfonos extranjeros pedir validación antes de unión automática.
   Bloquea tratamiento productivo de esas identidades en F2.
3. **Q3 — Una persona compra en dos tiendas:** opciones: cada tienda ve solo sus compras y datos
   propios, Administrador ve unión global; ficha e historial completos compartidos entre tiendas.
   Recomendación: primera. Confirmar además que resumen por tienda corresponde a tienda de compra
   para SICAR, con desglose para no reinterpretar silenciosamente el resumen nativo por cartera.
   Bloquea cruces de tienda y agregados F3.
4. **Q4 — Ranking del CRM:** opciones: mostrar compras SICAR como valor de cartera asignada con
   desglose y renglón «sin asignar»; conservar ranking POS y mostrar SICAR en resumen separado.
   Recomendación: segunda en este primer paso. Ninguna opción afecta metas, comisiones ni caja;
   no se conoce equivalencia entre vendedores SICAR y CORPUNISOUND. Bloquea ranking combinado F3.
5. **Q5 — Cancelaciones antiguas y horario:** opciones: conciliación semanal nocturna por ids,
   más ventana 48 h cada cinco minutos; conciliación diaria nocturna. Recomendación: semanal
   en piloto si no hay fecha de modificación indexada. Indicar horario real sin cobro y quién
   recibe el aviso de agente detenido. Bloquea calendario productivo F4, no el contrato de relectura.
6. **Q6 — Excel en tiendas conectadas:** opciones: bloquear importación de clientes Excel al activar
   agente; permitirla solo mediante conciliación supervisada adicional. Recomendación: bloquear
   clientes, mantener artículos/proveedores/exportación. Bloquea T2b y activación real.
7. **Q7 — Capacidad y conservación:** si la medición no cabe, opciones: ampliar capacidad en un
   trabajo separado autorizado; limitar años previa decisión expresa. Recomendación: conservar
   historia y dimensionar capacidad. Para intentos detallados: 90 o 180 días, archivados cifrados
   en Drive antes de purgar; recomendar 90, conservando decisiones y cursores. No ejecutar purga
   ni cambiar Render aquí. Bloquea expansión/retención productiva según mediciones.
8. **Q8 — Acciones sobre fichas solo SICAR:** opciones: consulta en esta primera entrega, manteniendo
   acciones de las fichas nativas unidas; añadir asignación, embudo y contactos para externas como
   fase adicional en SQLite. Recomendación: consulta primero. Bloquea solo ampliación de acciones;
   no introducirlas al JSON para evitar este trabajo.

Pendientes técnicos del mantenedor, no decisiones a inventar para Victor: tabla/columnas reales
de cliente y documentos; identificación de público; matriz de status/cancelación; fórmula de
importes; moneda/escalas; consistencia del motor MySQL; índices; disponibilidad de cambios
históricos; espacio libre y memoria reales de Render. F0/T1c aportan evidencia antes de activar.

## 13. Alcance de esta entrega documental

Solo se crea `docs/superpowers/plans/2026-10-13-crm-clientes-sicar.md`.
No se ejecutaron las fases, pruebas, SQL, navegador, respaldos ni cambios de infraestructura.
La verificación final compara estado Git con el inicial: los archivos sin seguimiento previos
se conservan. Cualquier aviso de acceso limitado de Git debe incluirse en la entrega a Victor.

## 14. Resultados F0 Ocosingo (2026-10-13, reporte del mantenedor del agente, solo SELECT/SHOW)

Fuente: `C:\Users\PC\proyectos\SICAR_F0_clientes.md` en DESKTOP-QIBAQER. Resumen normativo:

- Cliente de la venta: `COALESCE(ticket.cli_id, nota.cli_id, remision.cli_id)` via `venta.tic_id/not_id/rem_id`
  (todos indexados). Nunca hay dos documentos en una venta. 261 ventas 2015-2017 sin documento: se ignoran.
- Factura (`facturacfdiven` -> `facturacfdi.cli_id`) NO define al cliente: 527 ventas a publico facturadas a un
  cliente con nombre. Se guarda, si Victor lo aprueba, como "facturado a" (pregunta Q10).
- Publico en general: cli_id 1 mas variantes por nombre `^P.BLICO EN GENERAL` (ids 1,2,3,13,21,33,4566,4567,4572).
  Sin bandera; el RFC generico no sirve (12 personas reales lo tienen).
- Cliente: 38 columnas; usar solo cli_id, nombre, telefono, celular, mail, rfc, status, clave. PROHIBIDO leer
  `huella`, `muestra`, `foto` (biometricos, ~174 MB). Nunca `SELECT *`.
- Cancelada: `venta.status` 1 vigente / -1 cancelada. Fecha y deteccion de cancelacion: tabla `historial`
  (tabla='Venta', movimiento=2), una fila por cancelada, cursor por `his_id` (PK autoincremental). Altas/cambios/
  bajas de cliente tambien en `historial` (tabla='Cliente', 0/1/2). Esto reemplaza la conciliacion semanal (Q5):
  el agente lee `historial` por `his_id > cursor` en cada ciclo, sin escaneo por fecha.
- Importes: MXN, 2 decimales. `venta.total` = suma de `detallev.importeCon` (con IVA). `descTotal` = descuento del
  renglon con IVA; precio cambiado a mano no es descuento (comparar precioCon vs precioNorCon). Usar `venta.total`;
  186 ventas antiguas no cuadran con sus renglones.
- Volumen con nombre: 5,097 clientes, 10,918 ventas (10,257 vigentes $44,020,469.08; 661 canceladas), 24,036
  renglones. Peso estimado en SQLite: 10-40 MB por tienda. El riesgo de disco (Q7) baja a seguimiento.
- Todas las tablas InnoDB; lectura consistente sin bloqueos. Horario de cobro L-S ~07:50-18:05; ventana pesada
  20:00-07:00.
- SEGURIDAD BLOQUEANTE para F4: `consultas@'%'` tiene `FILE ... WITH GRANT OPTION` ademas de SELECT y
  `bind_address=*`. No es solo lectura. Corregirlo requiere root y autorizacion de Victor antes de activar el agente.

## 15. Decisiones cerradas por Victor (2026-10-13) — sustituyen las preguntas de la seccion 12

- **Q1:** Administrador crea/revoca llaves. Gerente revisa uniones de SU tienda; uniones entre tiendas solo
  Administrador. Permisos nuevos no se conceden a roles existentes ni sembrados (Victor los da a mano).
- **Q2:** telefono con varios candidatos o ambiguo/extranjero: no se une, queda en cola de revision.
- **Q3:** cada tienda ve solo sus compras y datos propios; quien tiene `ver_todas_las_sucursales` ve la union global.
  Resumen por tienda de SICAR = tienda donde se compro, con desglose por fuente.
- **Q4:** ranking por vendedor del CRM queda solo POS; SICAR va en resumen separado.
- **Q5:** RESUELTA por F0: el agente lee `historial` por his_id en cada ciclo; ademas relee 48 h. Carga historica
  solo de 20:00 a 07:00.
- **Q6:** al activar agente en una tienda se bloquea importar CLIENTES por Excel para esa tienda (previsualizar y
  aplicar). Articulos, proveedores y exportar no cambian.
- **Q7:** RESUELTA por F0 (10-40 MB por tienda). Se mantiene el presupuesto de disco de la seccion 9 como guarda.
  Recibos/intentos detallados: 90 dias.
- **Q8:** fichas solo SICAR son de consulta en esta entrega.
- **Q9 (respaldo):** se respalda en Drive toda la copia SICAR (T1c tal como esta).
- **Q10 (facturas):** las ventas facturadas a un cliente con nombre se muestran en su ficha como "facturado a",
  SIN sumar a monto, frecuencia, ultima compra ni score. El contrato v1 incluye un arreglo opcional `facturas`
  {ven_id, cli_id, fecha, total, estado}; si complica F1, se pospone a v2 sin bloquear el resto.

Orden de despacho: T1a -> T1b -> T1c -> T2a -> T2b -> T3a -> T3b -> T4a. F4 (agente real) bloqueada hasta corregir
los privilegios del usuario MySQL `consultas` (seccion 14).
