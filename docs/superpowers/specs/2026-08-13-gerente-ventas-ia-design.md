# Gerente de Ventas IA — Design Spec

## Contexto

Victor quiere una pieza que actúe como gerente de ventas: fija objetivos por persona, arma estrategias, da seguimiento constante, ajusta cuando se lo piden, y no suelta el objetivo hasta alcanzarlo. La visión final cubre **todo el personal**, con tipos de objetivo distintos según el rol (un Cajero/Vendedor tiene meta de venta; un Gerente de sucursal tendría objetivos operativos de otra naturaleza, etc.).

Por tamaño, este es el primero de varios sub-proyectos independientes que comparten un mismo framework:

1. **Cuentas de personal** — ya existe como infraestructura (`usuarios.js`/`roles.js`, roles Cajero/Gerente de sucursal/Administrador). Victor aún no ha dado de alta a nadie en producción, pero no hace falta construir nada nuevo aquí.
2. **Gerente de Ventas IA — rol Cajero/Vendedor** ← **este documento**. Primer tipo de objetivo implementado: metas de venta.
3. Objetivos para otros roles (p.ej. Gerente de sucursal) — sub-proyectos futuros, mismo framework, distinto contenido. Fuera de alcance aquí.

Hoy no existe ningún concepto de objetivo/tarea en el sistema. Se reutilizan piezas ya construidas y probadas: `crm.js` (segmentación de clientes), `predicciones.js` (demanda proyectada), el patrón de chat `/api/chat` con el SDK de Anthropic ya integrado (`server.js:1366`), y el catálogo `vendedores` (`DB.pos.vendedores`, con un campo `meta_mensual` que existe desde el sembrado inicial pero que ningún código usa hoy).

## Objetivo

1. Que cada vendedor (una cuenta de usuario ligada a un registro de `vendedores`) vea, en su propio dashboard, su objetivo de venta del mes, su progreso, y una lista de tareas concretas sugeridas para alcanzarlo.
2. Que esas tareas salgan de datos reales ya existentes en el sistema (clientes en riesgo/inactivos asignados a ese vendedor, productos con demanda proyectada alta en su sucursal) — no de una IA inventando sin fundamento.
3. Que el vendedor pueda pedir, en un chat, que se le ajuste una tarea o se le dé otra idea — y que ese ajuste quede acotado a acciones controladas, nunca a libre albedrío sobre la base de datos.
4. Que Victor (o el Gerente de sucursal) pueda fijar/cambiar la meta de cada vendedor.

## Fuera de alcance

- Objetivos para roles distintos a Cajero/Vendedor (Gerente de sucursal, Administrador) — sub-proyecto futuro.
- Un "reloj" que recalcule tareas de forma automática en segundo plano — v1 recalcula bajo demanda, cuando el vendedor abre su dashboard. Se puede agregar un cron después si hace falta (mismo patrón que `respaldoReloj.js`).
- Historial de objetivos pasados / metas ya alcanzadas — v1 solo mantiene el objetivo activo (`meta_mensual`, editable in-place). Si Victor quiere ver metas anteriores más adelante, es una extensión, no parte de esta pieza.
- Tipos de tarea más allá de "contactar cliente" y "empujar producto".
- Notificaciones push/email cuando se genera una tarea nueva — el vendedor las ve al entrar a su dashboard.
- Que la IA tenga acceso de escritura general a la base de datos — su única capacidad de escritura son dos funciones acotadas: reemplazar tarea, descartar tarea.

## Diseño

### 1. Modelo de datos

**`DB.admin.usuarios`** — campo nuevo opcional:
- `vendedor_id: number | null` — liga la cuenta de login con un renglón de `DB.pos.vendedores`. `null` = esa cuenta no participa del programa de objetivos (comportamiento actual, sin cambios). Se captura/edita desde la misma pantalla donde hoy se crean usuarios (Administrar Roles y Personal), por quien tenga el permiso `editar_objetivos_venta` (ver sección 4) — es un dato administrativo del personal, no algo que el propio vendedor controla.

**`DB.pos.vendedores`** — sin cambio de forma; se reactiva el campo `meta_mensual` que ya existe:
- Pasa de ser un valor sembrado sin uso a ser el objetivo activo del vendedor, editable por quien tenga el permiso `editar_objetivos_venta`.

**`DB.pos.tareas_venta`** (colección nueva) — una fila por tarea sugerida:
- `id`, `vendedor_id`
- `tipo`: `"contactar_cliente"` | `"empujar_producto"`
- `descripcion` — texto ya redactado (por el motor en crudo, o por la IA si la capa de redacción corrió)
- `cliente_id` — solo si `tipo === "contactar_cliente"`
- `producto_id` — solo si `tipo === "empujar_producto"`
- `estado`: `"pendiente"` | `"hecha"` | `"descartada"`
- `origen`: `"motor"` | `"ajuste"` — para poder distinguir en pruebas y en bitácora si la tarea salió del cálculo determinista o de un ajuste pedido por el vendedor
- `generada_en`, `completada_en` (null hasta que cambie de estado)

### 2. Motor determinista — `backend/gerenteVentas.js` (nuevo módulo, JS puro, sin IA)

Mismo patrón de archivo que `crm.js`: funciones planas que reciben `DB` y devuelven datos calculados, sin mutar nada salvo donde se indica.

```
calcularProgreso(DB, vendedorId, ahoraMs = Date.now())
  → { meta, vendido_mes, porcentaje, faltante, dias_restantes_del_mes }
```
- `vendido_mes`: suma de `pos.ventas` con `vendedor_id` igual y `estatus === "cerrada"`, filtradas al mes en curso vía `fechaLocal(ahoraMs)` (mismo criterio de fecha local que usa el resto del sistema).
- `meta` viene de `vendedores.meta_mensual`. Si es `0` o no está definida, `porcentaje` es `null` (no división entre cero) y se marca `sin_meta: true` — la pantalla lo muestra como "sin objetivo asignado" en vez de un progreso engañoso.

```
generarTareas(DB, vendedorId)
  → [{ tipo, descripcion, cliente_id | producto_id }]
```
- Clientes con `vendedor_asignado_id === vendedorId` cuyo segmento (`crm.js: calcularSegmento`) sea `"en_riesgo"` o `"inactivo"` → una tarea `"contactar_cliente"` por cliente.
- Top producto(s) con demanda proyectada alta (`predicciones.js`) en la sucursal del vendedor → tarea(s) `"empujar_producto"`.
- **No genera duplicados**: si ya existe una tarea `"pendiente"` para el mismo `vendedor_id` + `cliente_id`/`producto_id`, no se vuelve a crear.
- Función pura de cálculo — quien la llama decide si el resultado se inserta en `DB.pos.tareas_venta` (la ruta que arma el dashboard sí inserta; las pruebas pueden llamarla sin persistir).

### 3. Capa de redacción + chat de ajuste

Reutiliza el mismo cliente Anthropic ya inicializado en `server.js` (`claude-sonnet-4-6`), NO uno nuevo.

- **Ruta de dashboard** (`GET /api/gerente-ventas/:vendedorId` o equivalente): llama `calcularProgreso` + `generarTareas`, persiste tareas nuevas en `tareas_venta`, y le pide a Claude que redacte el resumen en tono natural — el prompt incluye el JSON ya calculado como única fuente de verdad; la instrucción explícita es no agregar cifras, clientes ni productos que no estén en ese JSON. Si la llamada a Claude falla, la ruta responde igual con los datos crudos del motor (la pantalla los muestra sin redacción, no truena ni deja de tener tareas).
- **Ruta de chat** (`POST /api/gerente-ventas/:vendedorId/chat`, mismo patrón de permiso/alcance que `/api/chat`): el vendedor escribe un mensaje; Claude responde con acceso a **dos herramientas acotadas únicamente**:
  - `reemplazar_tarea(tareaId, nuevaDescripcion)` — marca la vieja `"descartada"`, crea una nueva `"pendiente"` con `origen: "ajuste"`.
  - `descartar_tarea(tareaId)` — marca `"descartada"`.
  
  Ninguna otra tabla es alcanzable desde esta conversación. No hay tool de "crear objetivo" ni de "editar meta" — eso solo lo hace Victor/Gerente de sucursal desde su propia pantalla, nunca la IA a petición del vendedor.

### 4. Permisos (`backend/permisosCatalogo.js`, módulo `pos` existente — no se crea módulo nuevo)

- `usar_gerente_ventas` — ver el propio dashboard y usar el chat de ajuste. Se agrega al rol Cajero desde el diseño inicial (ya tiene `usar_asistente_ia`, incluirlo es el mismo criterio).
- `editar_objetivos_venta` — fijar/cambiar `meta_mensual` de un vendedor y ligar `vendedor_id` a una cuenta. Rol Gerente de sucursal/Administrador.

### 5. Pantalla del vendedor (frontend)

Nueva vista, visible en el dashboard solo si `usuario.vendedor_id` no es `null` y tiene el permiso: objetivo + barra de progreso arriba, lista de tareas con checkbox ("hecha"/"descartar"), cuadro de chat abajo — mismo componente visual que `AsistenteIA.jsx` (burbujas, avatar, indicador de escribiendo), adaptado a este contexto en vez de duplicado desde cero.

## Manejo de errores

- Cuenta sin `vendedor_id`: la vista no aparece (se oculta como cualquier tab sin permiso, no es un estado de error).
- `meta_mensual` en 0/sin definir: la pantalla lo dice explícitamente, no muestra 0% ni división inválida.
- Falla la llamada a Claude (dashboard o chat): las tareas ya calculadas por el motor siguen visibles; en el chat, un mensaje de error genérico, igual que el patrón ya existente en `/api/chat`.
- Ningún secreto (contraseñas, tokens) se incluye en el prompt enviado a Claude en ningún caso — el JSON que se le pasa solo trae progreso/tareas/nombres de clientes y productos.

## Testing

- `backend/gerenteVentas.test.js`, `node --test`, sin llamar a Claude — el motor es JS puro:
  - `calcularProgreso`: 0 ventas, meta en 0/indefinida, ventas fuera del mes en curso excluidas, cambio de mes.
  - `generarTareas`: con/sin clientes en riesgo, con/sin clientes inactivos, con/sin predicción de demanda, no-duplicado de tarea ya pendiente para el mismo cliente/producto.
- La capa de redacción/chat se prueba con un doble del cliente Anthropic (mismo patrón que ya deberían tener las pruebas de `/api/chat`, si existen) — no se prueba "qué tan bien redacta"; se prueba que el prompt recibe exactamente los datos del motor (sin inventar), y que `reemplazar_tarea`/`descartar_tarea` son las únicas dos acciones que la conversación puede ejecutar contra la base de datos, verificado por mutación (quitar la restricción de herramientas disponibles debe poner roja alguna prueba).
