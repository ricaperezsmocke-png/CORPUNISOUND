# CEDIS (sucursal 6) + Recepción de Compras

**Fecha:** 2026-07-10
**Proyecto:** CORPUNISOUND (Unisound)
**Estado:** Diseño aprobado — listo para plan de implementación

## Objetivo

Agregar el CEDIS (centro de distribución) como una sucursal más del sistema
(bodega central, sin validación de GPS al login), capaz de vender por Punto
de Venta (para registrar ventas de MercadoLibre y, más adelante, PrestaShop
mientras no exista integración automática), y darle un módulo nuevo,
**Recepción de Compras**, para registrar la llegada de mercancía de
proveedores con costo. La recepción actualiza el costo del producto y
recalcula sus 4 niveles de precio de venta conservando el % de utilidad de
cada uno. La salida de mercancía del CEDIS hacia las 4 tiendas físicas y la
sucursal MercadoLibre usa el módulo de **Traspasos** que ya existe, sin
cambios — el CEDIS decide y envía por su cuenta, sin que la tienda destino
tenga que solicitarlo primero.

**Fuera de alcance:**
- Devolución a proveedor.
- Órdenes de compra / pedido previos a la recepción (solo se registra lo
  que ya llegó físicamente).
- Integración real con PrestaShop — es un proyecto aparte cuando exista.
- Reemplazar o fusionar la sucursal virtual "MercadoLibre" (id 5) con el
  CEDIS — son sucursales separadas.
- Migración retroactiva: la mercancía ya existente en las 4 tiendas no se
  reprocesa como si hubiera pasado por el CEDIS.

## Decisiones de diseño (acordadas)

1. **CEDIS es la sucursal 6**, igual de "real" que las 4 tiendas físicas
   para efectos de aislamiento de datos, inventario, ventas y traspasos —
   la única diferencia es que no exige GPS al login.
2. **Con acceso a Punto de Venta**, para poder registrar manualmente ventas
   de canales online (ML, y PrestaShop cuando se conecte) hasta que existan
   integraciones automáticas equivalentes a la que ya tiene ML con la
   sucursal virtual 5.
3. **Sin rol nuevo por ahora.** Se agregan los permisos nuevos al catálogo;
   Victor decide desde Roles y Personal quién los tiene.
4. **Recepción de Compras registra:** proveedor, número de factura/remisión,
   comentario opcional, y una lista de renglones (producto, cantidad,
   costo unitario). Actualiza el costo del producto en el catálogo cuando
   cambia, y recalcula los 4 precios de venta manteniendo el % de utilidad
   de cada nivel (misma fórmula que ya usa el formulario de edición de
   productos: `precioVenta = costo * (1 + utilidad / 100)`).
5. **Salida a tiendas sin cambios de flujo:** se usa Traspasos tal cual
   existe hoy. El CEDIS es simplemente una sucursal de origen válida más.
6. **Sin GPS en el CEDIS**, igual que la sucursal virtual de ML. La
   validación de login (`validarUbicacionLogin` en `auth.js`) ya exime
   automáticamente a cualquier sucursal sin `lat`/`lng` configuradas — eso
   no cambia. Lo que sí cambia es que hoy dos lugares bloquean
   *configurar* coordenadas mirando `sucursal.ciudad === "Online"`
   (la pantalla "Ubicaciones de Tiendas" y la ruta que guarda
   coordenadas); eso se generaliza a un flag explícito `sin_ubicacion`,
   marcado en ML y en CEDIS, para no forzar al CEDIS —que sí es un lugar
   físico— a fingir ser "Online". El selector de sucursal en Login sigue
   filtrando solo por `ciudad === "Online"` sin cambios: el CEDIS sí debe
   aparecer ahí para que su personal pueda iniciar sesión.

## Arquitectura

### 1. CEDIS como sucursal 6

**`backend/server.js`** — `DB.pos.sucursales`:
```js
{ id: 6, nombre: "CEDIS", ciudad: "Chiapas", sin_ubicacion: true, lat: null, lng: null }
```
Se agrega también `sin_ubicacion: true` a la sucursal 5 (MercadoLibre). Los
dos lugares que hoy bloquean configurar coordenadas mirando
`sucursal.ciudad === "Online"` (la ruta `PUT /api/sucursales/:id/ubicacion`
en `server.js`, y el filtro de la lista en `UbicacionesTiendas` dentro de
`src/AdminRoles.jsx`) pasan a mirar `sucursal.sin_ubicacion === true`. El
filtro de sucursales en `src/Login.jsx` (que decide qué aparece en el
selector al iniciar sesión) NO cambia — sigue excluyendo solo
`ciudad === "Online"`, así que el CEDIS permanece visible ahí. La función
`validarUbicacionLogin` en `auth.js` no se toca: ya exime automáticamente a
cualquier sucursal sin `lat`/`lng`, y como CEDIS y ML nunca podrán tener
coordenadas configuradas, seguirán exentas sin más cambios.

Como `crearProducto` (en `backend/productos.js`) ya recorre
`DB.pos.sucursales` de forma genérica para sembrar existencia, y el
selector de sucursal, Traspasos, POS y Roles y Personal en el frontend ya
leen `DB.pos.sucursales` dinámicamente (no hay arreglos hardcodeados de
nombres de sucursal en `src/`), el CEDIS aparece en todo el sistema con
solo este cambio de datos — no se requiere tocar esas pantallas ni esas
funciones.

### 2. Módulo nuevo: Recepción de Compras

**`backend/permisosCatalogo.js`**
- Nuevo permiso: `{ clave: "recibir_compra", etiqueta: "Recibir Compras a Proveedor", modulo: "inventario", implementado: true }` (mismo patrón que `realizar_traspasos`: módulo existente, no crea categoría nueva en Roles y Personal).

**`backend/compras.js` (nuevo módulo)**
- `crearRecepcion(DB, { proveedor_id, factura, comentario, renglones }, sucursalId, usuario)`:
  - Valida que haya proveedor y al menos un renglón.
  - Por cada renglón `{ producto_id, cantidad, costo }`:
    - `ajustarExistencia(DB, producto_id, { cantidad, motivo: "Compra <factura> — <proveedor>", sucursal_id: sucursalId })` (entrada; reutiliza la función existente, que ya genera el registro en `movimientos_inventario`).
    - Si `costo` viene definido y es distinto al `costo` actual del producto, y el costo actual no es 0: recalcula los 4 `precioVenta` conservando el `utilidad` de cada nivel (`precioVenta = costo * (1 + utilidad / 100)`), redondeado a 2 decimales, y actualiza `producto.costo`.
    - Si el costo actual es 0 (producto sin costo previo): se asigna el costo capturado directamente y se recalculan los precios igual, sin intentar derivar un "cambio proporcional" desde cero.
  - Crea el registro en `DB.compras.recepciones`:
    ```js
    {
      id: 1,
      proveedor_id: 3,
      factura: "A-1024",
      comentario: "",
      sucursal_id: 6,
      renglones: [{ producto_id: 5, cantidad: 10, costo: 210.50 }],
      usuario_id: 2,
      usuario_nombre: "Encargado CEDIS",
      fecha: "2026-07-10T10:00:00.000Z",
    }
    ```
- `listarRecepciones(DB, alcance)`: usuario global ve todas (o filtra por sucursal como el resto de endpoints vía `alcanceSucursal`); usuario amarrado ve solo las de su sucursal.

**`backend/server.js`** — nuevas rutas, con `requiereLogin` + `requierePermiso("recibir_compra", ...)`:
- `GET /api/compras` — lista (con alcance).
- `POST /api/compras` — crea (sucursal = la del usuario amarrado; usuario global la trae en el body, igual que Traspasos).

### 3. Frontend

**`src/RecepcionCompras.jsx` (nuevo)**
- Entrada nueva en el menú lateral, gateada por `puede("recibir_compra")`.
- Formulario: selector de proveedor (catálogo existente, con alta rápida
  igual que en Inventario/Productos), campo de factura/remisión, comentario
  opcional.
- Tabla de renglones: reutiliza el buscador de productos ya existente
  (idéntico patrón al usado en Traspasos y Punto de Venta) para agregar
  productos; cada renglón captura cantidad y costo (prefijado con el costo
  actual del producto, editable).
- Botón "Registrar recepción" que llama a `POST /api/compras`.
- Vista de historial de recepciones (tabla con toolbar, patrón visual ya
  establecido).

**`src/InventarioProductos.jsx`, `src/Traspasos.jsx`, `src/PuntoDeVenta.jsx`,
selector de sucursal, Roles y Personal:** sin cambios — ya leen sucursales
dinámicamente.

## Casos borde

1. **Costo capturado igual al costo actual:** no se recalculan precios (evita
   trabajo innecesario y redondeos espurios).
2. **Producto sin costo previo (costo actual 0):** se asigna el costo
   capturado tal cual; los precios se recalculan con la fórmula normal.
3. **Usuario amarrado a CEDIS:** la recepción siempre se aplica a su propia
   sucursal, tomada del token (igual que ventas, cortes y traspasos) — no
   se puede recibir "a nombre de" otra sucursal.
4. **Historial de recepciones respeta aislamiento por sucursal**, igual que
   el resto de los módulos (Fase 3).
5. **Login en CEDIS o en la sucursal ML:** no exige GPS, por el flag
   `sin_gps`.

## Estrategia de pruebas

- `crearRecepcion` suma existencia en la sucursal correcta, genera un
  movimiento de inventario tipo "entrada" por cada renglón, actualiza el
  costo del producto cuando cambia, y recalcula los 4 precios de venta
  conservando el `utilidad` de cada nivel.
- `crearRecepcion` no recalcula precios si el costo capturado es igual al
  actual.
- `crearRecepcion` rechaza si falta proveedor o no hay renglones.
- `listarRecepciones` respeta el aislamiento por sucursal (amarrado vs
  global).
- El CEDIS aparece en el selector de sucursales, en Traspasos (como origen
  y destino válido) y en Roles y Personal sin tocar esas pantallas.
- Login con un usuario amarrado a CEDIS o a la sucursal ML no exige GPS;
  login amarrado a una de las 4 tiendas físicas lo sigue exigiendo.
