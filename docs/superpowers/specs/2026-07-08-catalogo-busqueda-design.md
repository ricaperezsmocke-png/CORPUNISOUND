# Buscador de productos + catálogos de Proveedores y Departamentos

**Fecha:** 2026-07-08
**Proyecto:** CORPUNISOUND (Unisound)
**Estado:** Diseño aprobado — listo para plan de implementación

## Objetivo

1. En **Traspasos**, reemplazar el `<select>` plano de producto por un buscador
   con el mismo estilo que "Buscar Artículo (F2)" del Punto de Venta: texto +
   filtros por categoría, departamento y proveedor, mostrando la existencia
   de la **sucursal origen** del traspaso (no una suma global).
2. El Punto de Venta gana el filtro de **proveedor** que hoy no tiene, para
   quedar igual que el nuevo buscador de Traspasos.
3. En **Inventario y Productos**, los campos Proveedor y Departamento ganan
   un botón "+" para dar de alta uno nuevo al vuelo, igual que ya funciona
   Categoría.

**Fuera de alcance:**
- Pantalla de edición completa de Proveedores (contacto, tiempo de entrega,
  condiciones de pago) — el alta rápida solo pide el nombre, igual que
  Categoría hoy.
- Migración forzada de productos ya existentes con el campo de texto libre
  `departamento` — ver "Casos borde".
- Deduplicación de nombres repetidos en categorías/proveedores/departamentos
  (no existe hoy para categorías; no se agrega aquí).

## Decisiones de diseño (acordadas)

1. **Departamento pasa a ser un catálogo real** (`DB["catalogo-productos"].departamentos`,
   forma `{ id, nombre }`, igual que categorías), en vez de un texto libre
   por producto. Los productos guardan `departamento_id` en vez del string
   `departamento`.
2. **Sin migración forzosa.** Los productos que ya existen con el campo de
   texto `departamento` (dato legado) siguen mostrando ese texto tal cual —
   no se crea automáticamente una entrada de catálogo por cada texto distinto
   que haya en datos existentes. `listarProductos` resuelve el nombre a
   mostrar así: si el producto tiene `departamento_id`, usa el nombre del
   catálogo; si no, cae al string legado `departamento`; si tampoco hay eso,
   "Sin definir".
3. **Proveedor gana alta rápida** con el mismo patrón que ya usa Categoría:
   botón "+" junto al selector, pide el nombre, lo crea, lo deja
   seleccionado. Los demás campos del proveedor (contacto, tiempo de
   entrega, condiciones de pago) quedan vacíos/en su valor por defecto.
4. **Buscador de Traspasos con existencia de la sucursal origen.** El listado
   de productos que ve el buscador se vuelve a pedir cada vez que cambia la
   sucursal origen efectiva (la del usuario amarrado, o la elegida en el
   formulario si es un usuario global), para que la existencia mostrada sea
   la real de esa tienda.
5. **Filtro de proveedor también en el Punto de Venta**, para que ambos
   buscadores (Traspasos y POS) queden con los mismos tres filtros:
   categoría, departamento, proveedor.
6. **Alta de departamentos/proveedores usa el mismo permiso que categorías**
   (`crear_producto`) — no se crean permisos nuevos.

## Arquitectura

### Backend

**`backend/productos.js`**
- Nuevo: `listarDepartamentos(DB)` → `DB["catalogo-productos"].departamentos`
  (mismo patrón que `listarCategorias`).
- Nuevo: `crearDepartamento(DB, nombre)` → valida nombre no vacío, crea
  `{ id, nombre }`, empuja al catálogo (mismo patrón que `crearCategoria`).
- Nuevo: `crearProveedor(DB, nombre)` → valida nombre no vacío, crea
  `{ id, nombre, contacto: "", tiempo_entrega_dias: 0, condiciones_pago: "" }`,
  empuja a `DB["catalogo-productos"].proveedores`.
- `crearProducto`/`actualizarProducto`: el campo `datos.departamento` (string)
  se reemplaza por `datos.departamento_id` (number|null) al escribir.
- `listarProductos`: agrega resolución de `departamento_nombre` con la
  regla de la Decisión 2 (catálogo → legado → "Sin definir"). El campo
  `departamento_id` del producto se expone tal cual (puede ser `null` en
  productos legado).

**`backend/server.js`**
- Importar `listarDepartamentos, crearDepartamento, crearProveedor` desde
  `./productos`.
- Nuevas rutas:
  - `GET /api/departamentos` (público, igual que `/api/categorias` y
    `/api/proveedores` hoy).
  - `POST /api/departamentos` — `requiereLogin` + `requierePermiso("crear_producto", ...)`.
  - `POST /api/proveedores` — mismo gating (hoy solo existe el `GET`).
- El seed inicial de `DB["catalogo-productos"]` gana `departamentos: []`
  (catálogo vacío al inicio; los productos semilla conservan su string
  `departamento` legado tal cual, sin backfill).

**`backend/testHelpers.js`**
- Agregar `departamentos: []` al fixture de `catalogo-productos`, mismo
  patrón que `categorias`/`proveedores`.

### Frontend

**`src/InventarioProductos.jsx`**
- Carga `departamentos` junto con `categorias`/`proveedores` en `cargarTodo`.
- Nuevo `crearDepartamentoRapido()` (mismo patrón que `crearCategoriaRapida`):
  `prompt` de nombre → `POST /departamentos` → agrega al estado → selecciona
  en el formulario.
- Nuevo `crearProveedorRapido()`, mismo patrón, `POST /proveedores`.
- Campo "Departamento" del formulario: pasa de `<input>` de texto libre a
  `<select>` + botón "+" (mismo layout que Categoría). `FORM_VACIO.departamento`
  se reemplaza por `FORM_VACIO.departamento_id`.
- Campo "Proveedor": ya es un `<select>`; se le agrega el botón "+" al lado.
- `guardarProducto`: el payload manda `departamento_id` en vez de
  `departamento`.
- `abrirEditar`: precarga `form.departamento_id` desde
  `seleccionado.departamento_id`.

**`src/PuntoDeVenta.jsx`**
- El `useMemo` que derivaba `departamentos` de valores distintos en
  `productos` se reemplaza por una carga real de `/api/departamentos`
  (mismo patrón que ya usa `categorias`).
- El filtro `filtroDepartamento` pasa a comparar por id
  (`String(p.departamento_id) === filtroDepartamento`), igual que ya hace
  `filtroCategoria`.
- Nuevo estado `proveedores` (carga de `/api/proveedores`) y
  `filtroProveedor`, con su propio `<select>` en la barra de filtros del
  modal "Buscar Artículo", y su línea correspondiente en el `useMemo` de
  `productosFiltrados`.

**`src/Traspasos.jsx`**
- Carga `categorias`, `departamentos`, `proveedores` (además de lo que ya
  carga).
- El campo "Producto" del formulario de envío deja de ser un `<select>`
  plano: un botón "Buscar producto" abre un modal (componente `Modal` local,
  mismo patrón que `PuntoDeVenta.jsx`) con: texto de búsqueda, filtros de
  categoría/departamento/proveedor, y tabla de resultados con existencia.
  Al hacer clic en una fila se guarda `producto_id` en el formulario, se
  cierra el modal, y se muestra el nombre del producto elegido en vez del
  selector.
- El listado de productos que alimenta este buscador se vuelve a pedir cada
  vez que cambia la sucursal origen efectiva: `usuario.ver_todas ?
  (form.sucursal_origen_id || "todas") : usuario.sucursal_id`, para que la
  columna de existencia sea siempre la de esa sucursal.

## Casos borde

1. **Producto legado con `departamento` de texto y sin `departamento_id`:**
   sigue mostrando su texto en el detalle del producto (vía
   `departamento_nombre` resuelto en el backend), pero **no aparece** al
   filtrar por un departamento específico del catálogo nuevo en POS o en el
   buscador de Traspasos — solo aparece bajo "Todos los departamentos". Esto
   es una consecuencia directa de la Decisión 2 (sin migración forzosa) y
   queda documentado aquí para que no sorprenda en producción.
2. **Usuario amarrado en Traspasos:** la sucursal origen es siempre la suya
   (no elige), así que el buscador simplemente usa su propia sucursal sin
   necesidad de refrescar por selección.
3. **Cambiar la sucursal origen después de haber elegido un producto:** el
   producto elegido no se deselecciona automáticamente (fuera de alcance);
   si el usuario cambia de sucursal origen después de elegir, puede volver a
   abrir el buscador para confirmar existencia actualizada antes de enviar —
   el backend igual valida existencia suficiente al crear el traspaso.
4. **Nombre de departamento/proveedor duplicado:** se permite (igual que
   categorías hoy); no se agrega validación de unicidad.

## Estrategia de pruebas

- `listarDepartamentos`/`crearDepartamento`: alta y lectura, nombre vacío
  rechazado.
- `crearProveedor`: alta con nombre, nombre vacío rechazado, campos
  secundarios en su valor por defecto.
- `listarProductos`: resuelve `departamento_nombre` desde el catálogo cuando
  hay `departamento_id`; cae al string legado cuando no hay `departamento_id`
  pero sí `departamento`; cae a "Sin definir" cuando no hay ninguno.
- `crearProducto`/`actualizarProducto`: guardan `departamento_id` (no ya
  `departamento` de texto).
- Frontend: no hay runner de pruebas para React en este repo (igual que el
  resto del proyecto) — verificación manual: alta rápida de proveedor y
  departamento desde Inventario, filtro por proveedor en POS, buscador con
  filtros en Traspasos mostrando existencia de la sucursal origen correcta.
