# Migración de Datos: SICAR → CORPUNISOUND + respaldo propio

**Fecha:** 2026-07-12
**Proyecto:** CORPUNISOUND (Unisound)
**Estado:** Diseño aprobado — listo para plan de implementación

## Objetivo

Construir una pantalla nueva y **recurrente** (no un script de una sola vez)
para traer datos de SICAR a CORPUNISOUND mientras ambos sistemas operan en
paralelo: cada sucursal tiene hoy su propia instalación independiente de
SICAR, y la migración a CORPUNISOUND es gradual. La pantalla importa los
archivos Excel que genera la exportación de SICAR ("Procesos > Exportar")
para **Artículos, Clientes y Proveedores**, con previsualización y
confirmación explícita por renglón antes de tocar la base de datos — el
mismo patrón que ya usa y que Victor ya validó en el importador de factura
XML CFDI de Recepción de Compras.

Además, cada pestaña ofrece un botón **"Exportar respaldo"** que genera un
`.xlsx` con el catálogo actual de CORPUNISOUND, en un formato que el mismo
importador de esta pantalla puede volver a leer. Es un respaldo para
restaurar CORPUNISOUND si algo falla — **no** necesita ser compatible con el
importador de SICAR (no hay flujo de regreso a SICAR).

**Fuera de alcance (acordado explícitamente):**
- **Formato Tickets, Impuestos e Insumos** — las otras pestañas del
  exportador de SICAR. Insumos es de restaurantes y no aplica a una tienda
  de instrumentos musicales; Formato Tickets e Impuestos no se migran.
- **Sincronización en tiempo real** con SICAR — el flujo es siempre manual:
  Victor exporta de SICAR, sube el archivo aquí, revisa y confirma.
- **Exportar hacia SICAR** — el respaldo solo se reimporta en CORPUNISOUND.
- Perfiles de importación tipo Nadro / Costos / Máximos y Mínimos de SICAR
  — solo el flujo "Estándar".

## Decisiones de diseño (acordadas)

1. **Solo tres tipos de dato:** Artículos, Clientes y Proveedores, uno por
   pestaña de la pantalla.
2. **Matching por clave, nunca por nombre.** Al importar, un renglón se
   reconoce contra lo existente así:
   - **Artículos:** por clave (`sku` del producto; también se acepta
     coincidencia con `clave_alterna`). Si coincide → actualización; si no
     → alta nueva.
   - **Clientes:** por `clave` **+ `sucursal_id`** (nunca clave sola). Se
     descartó el RFC como llave porque en el schema real
     (`backend/clientes.js`) el RFC tiene default `XAXX010101000` (el RFC
     genérico de "público en general"), así que muchos clientes lo comparten
     y no sirve como identificador único. La sucursal se agregó al matching
     tras la revisión final: cada sucursal corre su propia instalación
     independiente de SICAR, que numera clientes por su cuenta — sin este
     ajuste, un mismo `CLI001` de dos sucursales distintas se habría tratado
     como el mismo cliente y se habría pisado uno con datos del otro.
   - **Proveedores:** por `rfc` (los proveedores no tienen clave propia en
     CORPUNISOUND; el RFC de proveedor sí es un dato fiscal real y único).
3. **Sucursal obligatoria para Artículos y Clientes.** Cada instalación de
   SICAR corresponde a una sucursal específica, así que al importar
   Artículos o Clientes la pantalla pide "Sucursal de origen del archivo"
   (mismo patrón que "Sucursal que recibe" en Recepción de Compras: el
   selector solo aparece si el usuario tiene `ver_todas_las_sucursales`;
   si no, se usa su sucursal asignada). **Proveedores NO llevan sucursal**
   — son globales en el sistema.
4. **Confirmación explícita por renglón.** La previsualización muestra cada
   fila con su acción calculada (alta nueva / actualización) y un checkbox
   de confirmación por renglón — nada se aplica sin confirmar, replicando
   exactamente la tabla de confirmación del importador XML de
   `src/RecepcionCompras.jsx` (`confirmadosXml`).
5. **Detección de columnas por nombre de encabezado, no por posición**, con
   una lista de alias tolerantes por columna (ver "Riesgo abierto" al
   final: los nombres exactos de columna de SICAR aún no están confirmados
   con un archivo real).
6. **Aplicación fila por fila, no todo-o-nada**, validando lo más posible
   ANTES de mutar nada (ver sección "Aplicación" — lección directa del bug
   de `precios[0]` sobre `undefined` que dejó una compra a medias).
7. **Reimportar el mismo archivo no duplica:** el matching por clave
   convierte cada fila en actualización. Es el comportamiento esperado y se
   prueba explícitamente.
8. **Vive dentro del módulo "inventario" existente** — no es un módulo
   nuevo del sistema de permisos. Un solo permiso nuevo (`migrar_datos`)
   gatea toda la pantalla y todas sus rutas.

## Arquitectura

### 1. Permiso nuevo (sin módulo nuevo)

**`backend/permisosCatalogo.js`** — se agrega a `PERMISOS`:

```js
{ clave: "migrar_datos", etiqueta: "Migrar Datos (Importar/Exportar)", modulo: "inventario", implementado: true },
```

- **NO** se toca `MODULOS_SISTEMA` ni `MODULOS_QUE_REQUIEREN_PERMISOS`
  (`backend/validarPermisos.js`): el módulo "inventario" ya existe en
  ambos, así que el guardia de arranque pasa sin cambios.
- Gracias a `reconciliarRoles()` (ya activo en cada arranque, ver
  `backend/roles.js`), el permiso nuevo se une automáticamente al rol
  **Administrador**. Los demás roles (Gerente, Cajero, personalizados) NO
  lo reciben solos: Victor los habilita a mano desde Roles y Personal si
  quiere — así se evita una escalación de privilegio silenciosa sobre un
  permiso tan sensible como reescribir catálogos completos.

### 2. Dependencia nueva del backend

**`xlsx` (SheetJS)** en `backend/package.json` — para leer `.xls`/`.xlsx`
y para generar el respaldo. Hoy el backend solo tiene `fast-xml-parser`
para XML (usado por `compras.js`/`cfdi.js`); esta es la pieza equivalente
para Excel. Sin dependencias nativas, consistente con el resto del stack.

### 3. Backend: `backend/migracion.js` (nuevo)

Mismo estilo que `backend/compras.js` y `backend/cfdi.js`: comentario de
cabecera explicando el porqué, funciones puras que reciben `DB` como primer
argumento, errores con `throw new Error("mensaje claro en español")`.

Funciones:

- **`parsearExcel(bufferOArrayBase64, tipo)`** — lee el archivo con
  SheetJS, toma la primera hoja, y mapea encabezados a campos internos
  usando la tabla de alias (sección 4). No toca `DB`. Devuelve
  `{ columnas_detectadas, filas }` donde cada fila es un objeto con los
  campos internos reconocidos. Si faltan las **columnas mínimas** del tipo
  (clave y descripción/nombre para Artículos; clave y nombre para
  Clientes; RFC y nombre para Proveedores), lanza un error claro que
  enumera qué columna falta y qué encabezados sí se encontraron — el
  usuario lo ve ANTES de cualquier previsualización.
- **`previsualizarImportacion(DB, tipo, filas, sucursal_id)`** — por cada
  fila: valida (clave/RFC no vacío, números realmente numéricos) y busca
  coincidencia por la llave del tipo (decisión 2). Devuelve la
  previsualización: por fila `{ numero_fila, datos, accion: "alta" |
  "actualizacion", id_existente, valida, errores: [] }` más un resumen
  `{ total, altas, actualizaciones, invalidas }`. Las filas inválidas
  llevan su lista de motivos y **no** son confirmables. No toca `DB`.
- **`aplicarImportacion(DB, tipo, filasConfirmadas, sucursal_id,
  defaults, usuario)`** — aplica altas y actualizaciones (sección 6).
- **`exportarRespaldo(DB, tipo, sucursal_id)`** — genera el `.xlsx` de
  respaldo (sección 8).

### 4. Detección de columnas por alias

Cada campo interno tiene una lista de alias aceptados. La comparación es
insensible a mayúsculas/acentos y a espacios sobrantes. Ejemplo (Artículos):

| Campo interno | Alias asumidos (SIN confirmar contra archivo real) |
|---|---|
| `clave` | Clave, Código, Clave Artículo |
| `clave_alterna` | Clave Alterna, Código de Barras |
| `descripcion` | Descripción, Nombre, Artículo |
| `categoria` | Categoría |
| `departamento` | Departamento |
| `costo` | Costo, Precio Compra, Precio de Compra |
| `precio1`…`precio4` | Precio 1…Precio 4, Precio1…Precio4, Precio Público |
| `existencia` | Existencia, Exist., Inventario |
| `unidad` | Unidad, Unidad Venta, Unidad de Venta |
| `iva` | IVA, Impuesto, Impuestos |
| `ubicacion` | Ubicación, Localización |

Para Clientes: `clave` (Clave, Código), `nombre` (Nombre, Cliente, Razón
Social), `rfc` (RFC), `telefono`, `celular`, `email` (eMail, Correo),
`limite_credito` (Límite de Crédito, Límite Crédito), `dias_credito`
(Días de Crédito). Para Proveedores: `rfc` (RFC), `nombre` (Nombre,
Proveedor, Razón Social), `contacto` (Contacto, Teléfono).

Estas tablas viven como constantes en `backend/migracion.js`, en un solo
lugar, para que ajustarlas cuando llegue un archivo real de SICAR sea un
cambio de una línea por columna (ver "Riesgo abierto").

Columnas del archivo que no coinciden con ningún alias se ignoran y se
reportan en la previsualización como "columnas no reconocidas"
(informativo, no error).

### 5. Rutas nuevas en `server.js`

Todas con `requiereLogin, requierePermiso("migrar_datos",
resolverPermisosDeRol)` — mismo patrón exacto que las rutas de
`/api/compras`:

- **`POST /api/migracion/previsualizar`** — body
  `{ tipo: "articulos" | "clientes" | "proveedores", archivo_base64,
  nombre_archivo, sucursal_id }`. El frontend lee el archivo con
  `FileReader.readAsDataURL` y manda el contenido en base64 — misma
  filosofía sin-multer que el importador XML (que manda el texto del XML),
  adaptada a que Excel es binario. Ejecuta `parsearExcel` +
  `previsualizarImportacion` y devuelve la previsualización. **No muta.**
- **`POST /api/migracion/aplicar`** — body `{ tipo, filas, sucursal_id,
  defaults, nombre_archivo }` (el nombre del archivo se usa en el motivo
  de los ajustes de existencia, sección 6) donde `filas` son las filas
  confirmadas (con checkbox) tal
  como las devolvió la previsualización. El backend **revalida y rehace el
  matching** en el servidor antes de aplicar (no confía en la acción
  calculada que manda el frontend: la base pudo cambiar entre
  previsualizar y aplicar). Devuelve el resumen de aplicación (sección 6).
- **`GET /api/migracion/exportar?tipo=...&sucursal_id=...`** — devuelve el
  `.xlsx` de respaldo como descarga
  (`Content-Disposition: attachment`).

**Nota de infraestructura:** `server.js` hoy usa `app.use(express.json())`
con el límite default de ~100kb — insuficiente para un catálogo completo en
base64. Se sube el límite del body JSON (ej. `express.json({ limit:
"15mb" })`), decisión global consciente: es el mismo body parser que ya
recibe los XML de CFDI.

### 6. Aplicación: fila por fila, validar antes de mutar

Lección directa del bug real encontrado en `backend/productos.js` (crash
por `precios[0]` sobre `undefined` en productos legacy sin array de
precios, que dejó una compra aplicada a medias dentro de un `forEach` que
mutaba el DB fila por fila). `aplicarImportacion` se diseña para que un
fallo parcial nunca deje un estado ambiguo:

1. **Fase de validación (sin mutar):** se recorren TODAS las filas
   confirmadas y se revalida cada una contra el estado actual del `DB`
   (llave presente, números finitos, categoría/departamento resolubles,
   sucursal existente, defaults completos si hay altas). Las que fallan se
   apartan con su motivo — no bloquean a las demás.
2. **Fase de aplicación (una fila = una unidad):** cada fila válida se
   aplica dentro de su propio `try/catch`. Si a pesar de la validación una
   fila truena al aplicarse (caso defensivo), se registra en el resumen de
   errores y se continúa con la siguiente — las filas ya aplicadas quedan
   aplicadas y el resumen dice exactamente cuáles.
3. **Resumen final:** `{ actualizados: N, nuevos: M, errores: [{
   numero_fila, clave, motivo }] }` → el frontend lo muestra como
   "N actualizados, M nuevos, K con error (detalle)".

Qué hace cada acción, por tipo:

**Artículos**
- *Alta nueva:* `crearProducto(DB, datos, sucursal_id)` — ya crea las
  filas de existencia en todas las sucursales y pone la
  `existencia_inicial` del archivo en la sucursal seleccionada. Si la fila
  no trae categoría/departamento/unidad/impuesto, se usan los **datos por
  defecto para altas** que la pantalla pide antes de aplicar (ver sección
  7) — mismo concepto que la sección "Datos para Alta de Artículos" de la
  pantalla de importar de SICAR.
- *Actualización:* `actualizarProducto(DB, id, datos, sucursal_id)` con
  solo los campos que el archivo sí trae (los demás se conservan —
  `actualizarProducto` ya funciona así con `??`/`!== undefined`).
  - **Costo y precios:** si el archivo trae precios de venta, mandan los
    del archivo y la utilidad de cada nivel se recalcula hacia atrás desde
    el costo (mismo criterio que `actualizarTier` en
    `InventarioProductos.jsx`). Si solo trae costo, se actualiza el costo
    conservando los precios de venta actuales (la utilidad se recalcula
    hacia atrás) — NO se usa `actualizarCostoDesdeCompra`, que recalcula
    precios conservando utilidad: en una importación de catálogo el precio
    al público del archivo/actual es el dato que Victor quiere respetar.
  - **Existencia:** si el archivo trae columna de existencia, se ajusta la
    existencia de la sucursal seleccionada AL VALOR del archivo vía
    `ajustarExistencia` con `delta = valor_archivo − cantidad_actual` y
    motivo `"Importación SICAR — <nombre_archivo>"`, para que quede rastro
    en `movimientos_inventario`. Si no trae la columna, no se toca.
  - **Categoría/Departamento:** vienen por nombre en el archivo; se buscan
    por nombre (insensible a mayúsculas/acentos) y, si no existen, se
    crean con `crearCategoria`/`crearDepartamento` — tanto en altas como
    en actualizaciones (equivalente al checkbox "Categorías/Departamentos"
    del importador de SICAR).
  - **IVA:** la columna se interpreta tolerante ("IVA", "IVA(16%)", "SI",
    "16" → `true`; vacío/"NO"/"0" → `false`), consistente con que el
    negocio solo maneja IVA 16% (ver spec de compras 2026-07-10).

**Clientes**
- *Alta nueva:* `crearCliente(DB, datos)` con `sucursal_id` = la sucursal
  seleccionada.
- *Actualización:* `actualizarCliente(DB, id, datos)` con solo los campos
  presentes en el archivo. **No** se cambia el `sucursal_id` del cliente
  existente (el cliente ya vive donde vive; el selector de sucursal solo
  determina dónde nacen las altas nuevas).

**Proveedores**
- *Alta nueva:* `crearProveedor(DB, nombre, rfc)` + los campos extra
  (`contacto`) que traiga el archivo.
- *Actualización:* se actualizan nombre/contacto del proveedor con ese RFC.
- Sin sucursal en ningún caso.

### 7. Frontend: `src/MigracionDatos.jsx` (nuevo)

Mismo lenguaje visual que `src/RecepcionCompras.jsx`: componentes locales
`Modal`/`Campo` (no compartidos entre archivos, como el resto del
proyecto), tabla con `thead` azul `#1a7fe8`, aviso flotante
(`mostrarAviso`), clases `inputCls`. Estructura de la pantalla:

1. **Pestañas** (mismo patrón de tabs de RecepcionCompras): Artículos |
   Clientes | Proveedores.
2. **Selector "Sucursal de origen del archivo"** — visible solo en
   Artículos y Clientes, y solo si `puede("ver_todas_las_sucursales")`
   (igual que "Sucursal que recibe" en RecepcionCompras); si el usuario no
   ve todas, el backend usa su sucursal vía `alcanceSucursal`.
3. **Input de archivo** `.xls`/`.xlsx` → `FileReader` → `POST
   /api/migracion/previsualizar`.
4. **Tabla de previsualización:** una fila por renglón del archivo, con:
   los datos clave (clave/RFC, descripción/nombre, costo/precio si
   aplica), un badge de acción — **"Alta nueva"** (verde) o
   **"Actualización"** (azul) o **"Inválida"** (rojo, con el motivo) — y
   un **checkbox "Confirmar"** por fila (idéntico en espíritu a
   `confirmadosXml` del importador XML). Las filas inválidas se muestran
   con advertencia y su checkbox deshabilitado: quedan excluidas por
   defecto y no se pueden confirmar. Botones "Confirmar todas las
   válidas" / "Quitar todas" para no palomear cientos de filas a mano.
5. **Sección "Datos para alta de artículos"** (solo pestaña Artículos y
   solo si hay altas nuevas confirmadas a las que les falte el dato):
   selects de Categoría, Departamento, Unidad e Impuesto por defecto —
   calcada de la sección homónima de la pantalla Importar de SICAR.
6. **Botón "Aplicar importación"** → `POST /api/migracion/aplicar` → 
   **resumen final:** "N actualizados, M nuevos, K con error" con el
   detalle de errores por fila desplegado en tabla.
7. **Botón "Exportar respaldo"** por pestaña → descarga el `.xlsx` de
   `GET /api/migracion/exportar`.

Sin el permiso `migrar_datos` el usuario ni siquiera llega aquí (el tile
del Dashboard se oculta), y si llamara las rutas directo recibe 403 —
regla de oro de CONVENCION-PERMISOS.md: el frontend oculta, el backend
niega.

### 8. Exportación de respaldo

`exportarRespaldo(DB, tipo, sucursal_id)` genera un `.xlsx` (SheetJS,
una hoja) cuyos **encabezados son el primer alias canónico de cada campo**
de la tabla de la sección 4 — garantía por construcción de que el propio
importador lo vuelve a leer (y se prueba con un test de ciclo completo).

- **Artículos:** todo el catálogo, con la existencia de la **sucursal
  seleccionada** (el mismo selector de sucursal de la pestaña aplica a la
  exportación; así el ciclo exportar → importar es simétrico por
  sucursal). Incluye clave, clave alterna, descripción, categoría y
  departamento (por nombre), costo, precios 1–4, existencia, unidad, IVA,
  ubicación.
- **Clientes:** los clientes de la sucursal seleccionada (con clave,
  nombre, RFC, teléfono, celular, email, límite y días de crédito),
  excluyendo "Público en General" (id 0), que es un cliente de sistema
  compartido entre sucursales y no debe reimportarse.
- **Proveedores:** todos (RFC, nombre, contacto), sin sucursal.

El respaldo NO pretende ser compatible con el importador de SICAR — solo
con esta misma pantalla.

### 9. Cableado en Dashboard / App / Encabezado

- **`src/Dashboard.jsx` → `MODULOS`:** nueva entrada
  `{ id: "migracion", nombre: "Migración de Datos", icono: FileSpreadsheet,
  disponible: true, modulo: "inventario", permiso: "migrar_datos" }` —
  mismo patrón exacto que las entradas `traspasos` y `compras` (que también
  cuelgan del módulo "inventario" con permiso propio). `FileSpreadsheet`
  es de lucide-react, ya usado como fuente de íconos en todo el proyecto.
- **`src/EncabezadoModulo.jsx` → `TITULOS`:**
  `migracion: "Migración de Datos"`.
- **`src/App.jsx`:** agregar `"migracion"` al array `MODULOS` y la rama
  `{vista === "migracion" && <MigracionDatos onVolver={() =>
  setVista("dashboard")} permisos={usuario.permisos} usuario={usuario} />}`
  — mismas props y mismo patrón exacto que la rama de `compras` /
  `RecepcionCompras` ya existente en ese archivo.

## Flujo de datos completo (importación)

1. Victor exporta de SICAR (Procesos > Exportar) el Excel de Artículos,
   Clientes o Proveedores de una sucursal.
2. En CORPUNISOUND entra a Migración de Datos, elige la pestaña, elige la
   sucursal (Artículos/Clientes) y sube el archivo.
3. Backend: `parsearExcel` detecta columnas por alias; si faltan las
   mínimas, error claro y se acaba ahí. Si no, `previsualizarImportacion`
   calcula alta/actualización/inválida por fila. Nada se muta.
4. Victor revisa la tabla, confirma renglones con checkbox (las inválidas
   no son confirmables), y si hay altas de artículos sin
   categoría/departamento/unidad/impuesto, llena los datos por defecto.
5. "Aplicar importación": el backend revalida y rehace matching, valida
   todo lo posible antes de mutar, aplica fila por fila con `try/catch`
   individual, y responde el resumen.
6. Pantalla muestra "N actualizados, M nuevos, K con error (detalle)".
7. Si Victor vuelve a subir el mismo archivo, todas las filas salen como
   "Actualización" — no se duplica nada.

## Manejo de errores

- **Archivo ilegible o sin columnas mínimas** (falta clave o
  descripción/nombre, o RFC en Proveedores) → error claro antes de mostrar
  cualquier previsualización, enumerando qué falta y qué encabezados sí se
  reconocieron.
- **Fila inválida** (clave/RFC vacío, costo/precio/existencia no numérico)
  → se marca con advertencia y su motivo, queda excluida de la
  confirmación por defecto y no bloquea el parseo del resto.
- **Fallo al aplicar una fila** → se reporta en el resumen sin tumbar las
  filas ya aplicadas ni las que siguen (nunca un estado a medias sin
  reporte, ver sección 6).
- **Reimportación del mismo archivo** → actualizaciones, no duplicados
  (matching por clave/RFC). Comportamiento esperado, no error.
- **Sin permiso `migrar_datos`** → 403 en todas las rutas del backend;
  tile y pantalla ocultos en el frontend.
- **Sucursal no seleccionada** (usuario `ver_todas` en Artículos/Clientes)
  → la pantalla no deja previsualizar y el backend también lo rechaza.

## Estrategia de pruebas

Backend con `node --test`, patrón TDD del proyecto (mismo estilo que
`backend/compras.test.js` y `backend/productoClaveSatLocalizacion.test.js`,
usando `construirDBPrueba()` de `testHelpers`):

- **Parser:** un Excel fixture con las columnas esperadas se lee
  correctamente (campos mapeados por alias, con variantes de
  mayúsculas/acentos); columnas no reconocidas se reportan sin romper.
- **Columnas mínimas:** un fixture sin columna de clave lanza el error
  claro antes de previsualizar.
- **Matching:** clave existente → `accion: "actualizacion"` con el
  `id_existente` correcto; clave nueva → `accion: "alta"`. Ídem clave de
  cliente y RFC de proveedor.
- **Validación:** fila sin clave o con costo no numérico se marca inválida
  con su motivo, sin tumbar el parseo ni la previsualización de las demás.
- **Aplicación:** altas crean registros (artículo con existencia en la
  sucursal correcta, cliente con su `sucursal_id`, proveedor global);
  actualizaciones modifican solo los campos presentes en el archivo; una
  fila que falla al aplicarse aparece en `errores` y NO bloquea las demás
  (incluido el caso de producto legacy sin array `precios`).
- **Idempotencia:** aplicar dos veces el mismo fixture no duplica —
  la segunda pasada son puras actualizaciones.
- **Ciclo exportar → importar:** el `.xlsx` que genera `exportarRespaldo`
  se vuelve a leer con `parsearExcel` y produce las mismas filas.
- **Permisos:** sin `migrar_datos` → 403 en las tres rutas; con el permiso
  → funcionan. `validarSistemaDePermisos` sigue pasando (no hay módulo
  nuevo) y `reconciliarRoles` le da el permiso al Administrador sobre una
  base ya sembrada.

**Nota explícita sobre los fixtures:** los Excel de prueba se arman a mano
según las capturas de pantalla de SICAR — cuando haya un archivo real, hay
que revisar los fixtures y la tabla de alias juntos (ver riesgo abierto).

## Riesgo abierto (conocido y aceptado)

**No se cuenta todavía con un archivo real exportado de SICAR.** Los
nombres de columna de la sección 4 son suposiciones razonables basadas en
las capturas de las pantallas "Procesos > Exportar" y "Procesos >
Importar" de SICAR — **no son un hecho confirmado**. El diseño lo absorbe
de dos formas: (a) la detección es por alias tolerantes concentrados en
una sola tabla de `backend/migracion.js`, así que ajustar un nombre es un
cambio de una línea, y (b) si un archivo real trae encabezados que no
matchean, el usuario recibe el error de "columnas mínimas" con la lista de
lo que sí se reconoció, en lugar de una importación silenciosamente vacía
o incorrecta. **Acción pendiente:** en cuanto Victor consiga un export
real de cada pestaña de SICAR, verificar/ajustar la tabla de alias y los
fixtures de prueba antes de dar la funcionalidad por terminada.
