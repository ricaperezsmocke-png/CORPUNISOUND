# Pantalla "Artículo" en Recepción de Compras + estilo POS + importar XML

**Fecha:** 2026-07-10
**Proyecto:** CORPUNISOUND (Unisound)
**Estado:** Diseño aprobado — listo para plan de implementación

## Objetivo

Rehacer **Recepción de Compras** (`src/RecepcionCompras.jsx`) para que, en vez
del formulario simple actual (una fila con cantidad/costo por producto), cada
producto que se agrega a una recepción pase por una pantalla completa tipo
SICAR ("Artículo") donde se revisan/ajustan clave SAT, localización, costo,
descuento, IVA y los 4 niveles de margen/precio de venta — y que la pantalla
de Recepción de Compras en sí adopte el mismo esqueleto visual que ya tiene
Punto de Venta (barra lateral de iconos, barra de atajos F2-F8, tabla tipo
"ticket"), replicando la pantalla real de Compras de SICAR. Además, se agrega
la capacidad de importar una factura de proveedor en XML (CFDI 4.0) para
precargar los renglones automáticamente.

**Fuera de alcance:**
- **Pedido (F10)** — órdenes de compra previas a la recepción.
- **Doc (Alt+D)** — tipos de documento distintos para la recepción.
- **Dev Pro (Alt+N)** — devolución a proveedor.
- Catálogo de impuestos configurable (IEPS, tasas distintas) — solo IVA 16%.
- Catálogo de búsqueda de productos/servicios distinto al de Clave SAT (ese
  sí entra, ver abajo).
- Reconciliación retroactiva de compras ya registradas antes de este cambio
  (no se les agrega clave SAT/localización/descuento retroactivamente).

## Decisiones de diseño (acordadas)

1. **Costo se captura siempre neto (sin IVA).** El IVA (16%, único impuesto
   que maneja el negocio) es informativo: el sistema lo suma encima del costo
   neto para mostrar el total "con impuesto" junto a las cifras históricas,
   pero **no** se resta de nada — los márgenes y precios de venta se calculan
   siempre sobre el costo neto.
2. **Descuento por renglón** (`$` y `%`) se aplica sobre el costo capturado
   ANTES de recalcular márgenes: `costo_final = (costo − desc_$) × (1 − desc_%/100)`.
   Ese `costo_final` es el que se guarda como nuevo costo del producto.
3. **Histórico de "Último precio de compra" y "Promedio"** se calculan al
   vuelo a partir de `compra_detalle` ya existente — no requiere tabla nueva.
   Se muestran con y sin IVA (sumando el 16% para la columna "con impuesto").
4. **Clave SAT con catálogo de búsqueda real**, usando el catálogo público
   `c_ClaveProdServ` (~55,000 claves) mantenido por el proyecto open-source
   `phpcfdi/sat-catalogos-populate` en GitHub — fuente confiable y
   ampliamente usada en México para CFDI 4.0. Se importa una sola vez a una
   tabla SQLite de solo-lectura.
5. **Botones "Márgenes Anteriores" / "Precios Anteriores"** sí se incluyen:
   restauran los valores de "antes de esta compra" (el primero recalcula con
   el costo nuevo conservando los % viejos; el segundo restaura los precios
   de venta exactos de antes, ignorando el costo nuevo).
6. **Importar XML de factura (F8) se construye ahora**, contra el estándar
   CFDI 4.0 del SAT (no se cuenta con un XML real de muestra; se sigue el
   estándar oficial). El emparejamiento factura→producto **siempre requiere
   confirmación manual por renglón** — nunca se actualiza inventario/costo
   sin que Victor lo revise. Se agrega el campo RFC a Proveedores para
   detectar/emparejar automáticamente al emisor de la factura.
7. **Botones "Doc", "Pedido", "Dev Pro"** se muestran en la barra (fidelidad
   visual con SICAR) pero solo disparan un aviso "próximamente" — no tienen
   función real todavía, igual que ya existen placeholders similares en
   Punto de Venta ("Carga masiva").
8. **El esqueleto visual sigue el patrón ya usado en `PuntoDeVenta.jsx`**:
   componentes `BotonBarra`/`BotonLateral`/`Modal` locales (no compartidos
   entre archivos — así está ya el resto del proyecto), atajos de teclado
   por F-keys/Alt, tabla tipo "ticket" con fila seleccionable.

## Arquitectura

### 1. Cambios de datos

**`backend/productos.js`** — nuevos campos en producto: `clave_sat` (texto),
`localizacion` (texto libre). Se agregan a `crearProducto`/`actualizarProducto`
igual que los campos existentes (`iva`, `neto`, etc.), con default `""`.

**`backend/productos.js`** — `crearProveedor` gana el campo `rfc` (texto,
opcional). Se usa para emparejar al emisor de una factura XML.

**`backend/compras.js`** — cada renglón de `compra_detalle` gana
`descuento_pesos` y `descuento_porcentaje` (default 0). El registro `compra`
gana `uuid_cfdi` (opcional, folio fiscal de la factura si vino de una
importación XML) para detectar duplicados.

### 2. Cálculo de costo con descuento e IVA informativo

**`backend/productos.js`** — `actualizarCostoDesdeCompra(DB, id, nuevoCosto)`
ya existe y recalcula los 4 precios conservando `utilidad`; no cambia su
firma. `backend/compras.js` (`crearRecepcion`) calcula `costo_final` a partir
de `costo`, `descuento_pesos` y `descuento_porcentaje` ANTES de llamar a
`actualizarCostoDesdeCompra` con ese valor ya neto:

```js
const costoFinal = Math.round(
  (costo - (descuento_pesos || 0)) * (1 - (descuento_porcentaje || 0) / 100) * 100
) / 100;
```

El IVA (16%, constante `TASA_IVA = 0.16` en `backend/productos.js` o
`compras.js`) solo se usa para *mostrar* `costo_final * 1.16` como "con
impuesto" — no participa en ningún cálculo que se guarde.

### 3. Histórico de precio de compra

**`backend/productos.js` o `backend/compras.js`** — nueva función
`historialCostoProducto(DB, productoId)`:
- Filtra `DB.inventario.compra_detalle` por `producto_id`, ordenado por fecha
  de la compra asociada.
- `ultimo`: costo del renglón más reciente (o `null` si no hay historial).
- `promedio`: promedio simple de todos los costos históricos (o `null`).
- Devuelve ambos con y sin IVA (`{ neto, conIva }` cada uno).
- Se expone en un endpoint existente o nuevo, ej.
  `GET /api/productos/:id/historial-costo`, protegido con
  `requierePermiso("recibir_compra", ...)` (mismo permiso que ya gatea el
  módulo).

### 4. Catálogo de Claves SAT

- Script de importación **una sola vez**, no parte del arranque normal:
  `backend/scripts/importarClavesSat.js` — lee un archivo ya descargado y
  versionado en el repo (`backend/data/c_ClaveProdServ.csv`, tomado de
  `phpcfdi/sat-catalogos-populate`) y lo carga a una tabla nueva
  **`claves_sat`** (columnas `clave`, `descripcion`) **dentro del mismo
  `datos.sqlite`** que ya usa `backend/persistencia.js` — reutiliza la
  misma conexión de better-sqlite3, sin archivo aparte. Es clave que esta
  tabla **nunca se cargue al objeto `DB` en memoria** ni pase por
  `cargar()`/`guardar()` (que serializan todo `DB` a JSON en cada cambio):
  se consulta siempre con SQL directo (`buscarClavesSat`, ver abajo), igual
  de aislada que una tabla de solo-lectura.
- **`backend/clavesSat.js` (nuevo)** — `buscarClavesSat(texto, pagina)`:
  búsqueda por `LIKE` sobre clave/descripción, paginada (mismo patrón que el
  resto de búsquedas del proyecto).
- **`backend/server.js`** — `GET /api/sat/claves?q=texto&pagina=1`,
  protegido con `requiereLogin` (sin permiso adicional — es solo consulta de
  un catálogo de referencia, igual que categorías/proveedores).
- **Frontend** — modal de búsqueda junto al campo Clave SAT en la pantalla
  "Artículo", visualmente igual al buscador de productos ya existente
  (input de texto, tabla de resultados, paginación).

### 5. Pantalla "Artículo" (modal)

**`src/ArticuloCompra.jsx` (nuevo)** — se monta desde `RecepcionCompras.jsx`
al agregar o editar (F4) un renglón. Recibe el producto seleccionado, el
histórico de costo (`historialCostoProducto`), y devuelve al padre el
renglón armado al aceptar.

Secciones (calcadas de la pantalla de SICAR, con las simplificaciones ya
acordadas):
- **Información del Artículo:** Clave y Descripción (solo lectura, vienen
  del producto), Clave SAT (input + botón que abre el buscador del catálogo
  SAT), Existencia actual (solo lectura), Factor (solo lectura), Localización
  (input libre).
- **Precios (antes de esta compra, solo lectura):** Último precio de compra
  / promedio (neto y con IVA, de `historialCostoProducto`), los 4 % de
  margen y precios de venta actuales del producto — sirven de referencia y
  alimentan los botones de "anteriores".
- **Detalle de la Compra:** casilla "Aplica IVA (16%)", Cantidad, Factor
  (solo lectura), Costo (neto, editable), Neto (checkbox informativo, sin
  efecto en el cálculo — se guarda igual que hoy en el producto), Desc $,
  Desc %, y debajo "Precio sin impuestos: unitario / total línea"
  (`costo_final` y `costo_final × cantidad`, calculados en vivo).
- **Precios de Venta (después de esta compra, editable):** los 4 % de margen
  y sus precios de venta, recalculados en vivo con `costo_final` al cambiar
  costo/descuento, pero editables a mano si Victor quiere ajustar un precio
  directamente (en ese caso el % se recalcula hacia atrás desde el precio
  tecleado, igual que ya hace `actualizarTier` en `InventarioProductos.jsx`).
- **Botones:** "Márgenes Anteriores" (copia los % de "antes" a los campos
  editables, recalculando con el costo nuevo), "Precios Anteriores" (copia
  los precios de venta exactos de "antes", ignorando el costo nuevo),
  "Cancelar", "Aceptar" (arma el renglón y lo regresa a `RecepcionCompras`).

### 6. Rediseño de `RecepcionCompras.jsx` (estilo POS)

Mismo esqueleto que `PuntoDeVenta.jsx`, adaptado:

- **Encabezado:** campo de código/clave (Enter agrega directo si el producto
  existe y abre "Artículo" para revisarlo; si no se encuentra, abre el
  buscador), interruptor "Neto" (mismo campo informativo del producto activo
  en la fila seleccionada), selector de Proveedor (con alta rápida, ya
  existe), moneda "MXN" (fijo, sin conversión — no se maneja multi-moneda).
- **Barra superior (BotonBarra), F2-F8:**
  - Buscar (F2) → abre buscador de productos (patrón ya existente).
  - Editar (F4) → con fila seleccionada, reabre "Artículo" para esa fila.
  - Cantidad (F5) → modal rápido de solo cantidad (patrón igual al de PDV).
  - Remover (F6) → quita la fila seleccionada.
  - Desc. (F7) → modal rápido de solo descuento (%, patrón igual al de PDV).
  - Imp. XML (F8) → abre el importador de factura XML (sección 7).
  - Doc (visual, sin atajo activo) y Pedido (F10) → aviso "próximamente".
- **Barra lateral (BotonLateral):**
  - Cerrar (ESC) → equivale a "Registrar recepción" (llama `POST /api/compras`).
  - Prov. (Alt+P) → selector de proveedor (ya existe, se reubica aquí).
  - A. Ráp (Alt+A) → recibir pieza fuera de catálogo (mismo patrón que
    "producto rápido" de PDV — no descuenta/afecta inventario formal, queda
    marcada igual que en ventas).
  - Dev Pro (Alt+N) → aviso "próximamente".
  - Espera (Alt+E) / Rec. (Alt+R) → poner/recuperar una recepción en curso
    sin registrar (mismo patrón ya construido en PDV, en memoria del
    componente, no persistido en backend).
- **Tabla del "ticket":** columnas Cant, Descripción, Factor, Exist.,
  % Util./Precio Venta, $ Desc, Precio U. (costo neto final), Importe — fila
  seleccionable con clic (resalta, habilita F4/F5/F6/F7), botones +/- inline
  para cantidad rápida (igual que PDV).
- **Pie:** Devoluciones Pro (fijo en $0.00 — no hay flujo de devolución
  todavía), Descuento (suma de `desc_$` + lo que representa `desc_%` de
  todos los renglones), Total (suma de importes).

### 7. Importar factura XML (F8)

**`backend/cfdi.js` (nuevo)** — `parsearFacturaXML(xmlTexto)`:
- Usa una librería ligera de parseo XML sin dependencias nativas (se agrega
  como dependencia nueva del backend).
- Extrae del CFDI 4.0: `emisor` (RFC, nombre), `folioFiscal` (UUID del
  Complemento TimbreFiscalDigital), `fecha`, y `conceptos[]`:
  `{ clave_sat, no_identificacion, descripcion, cantidad, valor_unitario, importe, tasa_iva }`
  (el `valor_unitario` del CFDI ya es el precio antes de impuesto — coincide
  con la convención de "costo neto" de este proyecto).

**`backend/server.js`** — `POST /api/compras/importar-xml`, protegido con
`requierePermiso("recibir_compra", ...)`. Recibe `{ xml: "<texto del xml>" }`
(el frontend lee el archivo con `FileReader` en el navegador y manda el
texto — sin necesidad de subir archivos binarios ni agregar `multer`).
Devuelve el resultado de `parsearFacturaXML` tal cual, sin tocar la base de
datos — el emparejamiento a productos ocurre en el frontend.

**`src/RecepcionCompras.jsx` — pantalla de revisión tras importar:**
1. Si el RFC del emisor coincide con un proveedor existente, se
   preselecciona. Si no, se ofrece un alta rápida (reutilizando
   `crearProveedorRapido`, ahora con campo RFC) prellenada con el RFC y
   nombre del emisor.
2. Se muestra una fila por cada concepto de la factura, con una sugerencia
   de producto (por coincidencia de `clave_sat`, o si no hay match exacto,
   por texto similar en la descripción) — **Victor confirma o cambia cada
   una** desde un buscador (mismo patrón de búsqueda de productos). Si un
   concepto no tiene producto correspondiente, un botón "Crear producto"
   abre "Artículo" en modo alta, prellenado con descripción/clave SAT/costo
   del concepto.
3. Al confirmar todas las filas, se agregan como renglones a la tabla de la
   recepción (con costo neto, cantidad e IVA tomados del XML) — cada uno ya
   pasó, en esencia, por los mismos datos que "Artículo" captura a mano.
4. El folio fiscal (`uuid_cfdi`) se guarda en el registro de compra; si
   Victor intenta importar el mismo XML dos veces, `crearRecepcion` rechaza
   con un error claro ("Esta factura ya fue registrada el <fecha>").

## Casos borde

1. **Producto sin historial de compras previo:** `historialCostoProducto`
   devuelve `null` en último/promedio; la pantalla "Artículo" muestra "—" en
   vez de un número.
2. **Costo capturado igual al costo actual (después de descuento):** no se
   recalculan precios, igual que ya hace `actualizarCostoDesdeCompra` hoy.
3. **Concepto de factura XML sin coincidencia de producto:** no bloquea el
   resto de la importación — se resuelve por separado (crear producto o
   descartar ese renglón).
4. **Factura XML ya importada antes (mismo `uuid_cfdi`):** se rechaza con
   error explícito, no se duplica ni se sobreescribe la recepción anterior.
5. **Producto usado en "Precios Anteriores" que nunca tuvo precios (array
   `precios` legado/ausente):** el botón no hace nada si no hay "antes" que
   restaurar (mismo comportamiento defensivo que ya tiene
   `actualizarCostoDesdeCompra` con productos legado).
6. **Proveedor sin RFC capturado** (proveedores creados antes de este
   cambio): la importación de XML simplemente no encuentra coincidencia y
   pide alta manual — no se asume ni se fuerza un emparejamiento.

## Estrategia de pruebas

- Cálculo de `costo_final` con descuento en $ y en % (individual y
  combinado), y que el IVA no altere ese valor guardado.
- `historialCostoProducto`: último y promedio correctos con 0, 1 y varias
  compras previas; con y sin IVA.
- Import del catálogo de Claves SAT: búsqueda por texto encuentra
  resultados esperados, paginación correcta.
- `parsearFacturaXML`: extrae emisor, folio fiscal y conceptos correctos de
  un CFDI 4.0 de prueba (se construye un XML de muestra siguiendo el
  estándar, ya que no se cuenta con uno real).
- `crearRecepcion` rechaza una segunda importación con el mismo `uuid_cfdi`.
- Guardia de arranque (`validarSistemaDePermisos`) sigue pasando sin
  cambios — esta funcionalidad no agrega módulos/permisos nuevos, reutiliza
  `recibir_compra`.
- Verificación manual en navegador: agregar producto → pantalla Artículo →
  Aceptar → tabla tipo ticket → Registrar recepción; y el flujo completo de
  importar un XML de prueba → revisión → confirmar → recepción registrada.
