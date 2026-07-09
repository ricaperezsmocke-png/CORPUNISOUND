# Inventario por tienda + Traspasos entre sucursales

**Fecha:** 2026-07-08
**Proyecto:** CORPUNISOUND (Unisound)
**Estado:** Diseño aprobado — listo para plan de implementación

## Objetivo

1. Que un producto nuevo aparezca en el inventario de **las 5 sucursales**
   (Ocosingo, Yajalón, San Cristóbal, Palenque, MercadoLibre) desde el momento
   en que se da de alta, con existencia inicial en la sucursal de quien lo
   creó y 0 en las demás — hoy solo se siembra en sucursal 1, así que las
   otras tiendas no lo ven en su lista de inventario.
2. Un módulo nuevo, **Traspasos**, para mover existencia de un producto de
   una sucursal a otra, con un estado intermedio "en tránsito" hasta que la
   tienda destino confirma que llegó.

**Fuera de alcance:**
- Traspasos parciales o con cantidad distinta a la enviada (se recibe siempre
  exactamente lo que se envió; los problemas se anotan como comentario, no
  como ajuste de cantidad).
- Aprobación previa al envío (cualquiera con el permiso puede enviar sin que
  otro lo autorice primero).
- Persistencia real (sigue en memoria + SQLite tal como ya funciona el resto
  del sistema).

## Decisiones de diseño (acordadas)

1. **No hay bases de datos separadas por tienda.** Se mantiene el modelo
   actual: una sola fuente de datos, con `sucursal_id` en cada fila de
   existencia. Esto es lo que ya permite el aislamiento por sucursal (Fase 3)
   y es indispensable para que un traspaso pueda mover cantidad de una fila a
   otra sin sincronizar bases de datos distintas.
2. **`crearProducto` siembra existencia en las 5 sucursales**, no solo en la
   1. La cantidad inicial capturada en el formulario se aplica a la sucursal
      del usuario que lo está dando de alta (tomada del token, igual que
      ventas/cortes); las demás sucursales arrancan en 0.
   - Usuario global (Administrador) sin sucursal amarrada al crear: se aplica
     a la sucursal que tenga seleccionada en el selector (o sucursal 1 si
     tiene "Todas" seleccionado).
3. **Traspaso con estado intermedio "en tránsito".**
   - Al crear el traspaso: se descuenta de inmediato la existencia de la
     sucursal origen. Se valida que haya suficiente existencia — si no,
     se rechaza (igual que una venta no puede vender más de lo que hay).
   - El traspaso queda con estatus `en_transito`. La sucursal destino
     **no** recibe la existencia todavía.
   - Al confirmar recepción: se abona a destino **exactamente** la cantidad
     que se envió (no se puede editar la cantidad al recibir). Se puede
     capturar un **comentario de recepción** libre y opcional (para reportar
     mercancía dañada, faltante evidente, etc., sin que eso cambie la
     cantidad registrada). El traspaso pasa a `recibido`.
4. **Permiso propio e independiente:** `realizar_traspasos`, en el catálogo
   de permisos bajo el módulo existente `inventario` (no crea una categoría
   nueva en Roles y Personal). Cubre crear, ver y recibir traspasos. Se
   asigna a quien Victor decida desde Roles y Personal — no está atado a
   `ajustar_existencia`.
5. **Las 5 sucursales participan**, incluida MercadoLibre — para poder
   reservar/mover stock hacia el canal virtual también.
6. **Módulo propio en el menú** ("Traspasos"), no una pestaña dentro de
   Inventario.
7. **Cada movimiento de traspaso genera entradas en
   `movimientos_inventario`** (salida en origen al enviar, entrada en destino
   al recibir) para que el historial de inventario sea consistente con
   ajustes manuales y ventas.

## Arquitectura

### Modelo de datos

**Nueva colección `DB.inventario.traspasos`:**

```js
{
  id: 1,
  producto_id: 5,
  cantidad: 10,
  sucursal_origen_id: 1,
  sucursal_destino_id: 2,
  estatus: "en_transito", // | "recibido"
  comentario_envio: "",           // opcional, al crear
  comentario_recepcion: null,     // opcional, al recibir
  usuario_envio_id: 3,
  usuario_envio_nombre: "Gerente Ocosingo",
  usuario_recibe_id: null,
  usuario_recibe_nombre: null,
  fecha_envio: "2026-07-08T10:00:00.000Z",
  fecha_recepcion: null,
}
```

### Backend

**`backend/productos.js`**
- `crearProducto(DB, datos, sucursalId)`: nueva firma que recibe la sucursal
  del creador. Siembra una fila de existencia por cada sucursal en
  `DB.pos.sucursales` (+ la 5, ML, que ya vive ahí o se agrega si falta);
  la sucursal del creador recibe `existencia_inicial`, las demás 0.
- `actualizarProducto`: el ajuste de `existencia_minima`/`existencia_maxima`
  hoy está hardcodeado a `sucursal_id === 1` — se generaliza para recibir la
  sucursal en alcance (igual patrón que `ajustarExistencia`).

**`backend/traspasos.js` (nuevo módulo)**
- `crearTraspaso(DB, { producto_id, cantidad, sucursal_destino_id, comentario }, sucursalOrigenId, usuario)`:
  valida existencia suficiente en origen, descuenta de inmediato (vía
  `ajustarExistencia`, motivo `"Traspaso #<id> — envío a <sucursal>"`), crea
  el registro en `traspasos` con estatus `en_transito`.
- `recibirTraspaso(DB, id, { comentario }, sucursalUsuarioId, usuario)`:
  valida que el traspaso exista, esté `en_transito`, y que la sucursal del
  usuario que confirma sea la `sucursal_destino_id` del traspaso (no puede
  recibir por otra tienda). Abona la existencia en destino (crea la fila si
  el producto no tenía existencia ahí todavía), marca `recibido`.
- `listarTraspasos(DB, alcance, filtroEstatus)`: para usuario amarrado,
  devuelve traspasos donde su sucursal es origen O destino (necesita ver
  ambos lados). Usuario global ve todos, puede filtrar por sucursal como el
  resto de los endpoints.

**`backend/permisosCatalogo.js`**
- Nuevo permiso: `{ clave: "realizar_traspasos", etiqueta: "Realizar Traspasos entre Sucursales", modulo: "inventario", implementado: true }`.

**`backend/server.js`** — nuevas rutas, todas con `requiereLogin` +
`requierePermiso("realizar_traspasos", ...)`:
- `GET /api/traspasos` — lista (con alcance).
- `POST /api/traspasos` — crea (sucursal origen = la del usuario amarrado;
  usuario global la trae en el body).
- `POST /api/traspasos/:id/recibir` — confirma recepción.

### Frontend

**`src/Traspasos.jsx` (nuevo)**
- Entrada nueva en el menú lateral, gateada por `puede("realizar_traspasos")`.
- Dos vistas dentro de la misma pantalla: "Enviar traspaso" (formulario:
  producto, cantidad, sucursal destino, comentario opcional) y "Traspasos
  pendientes de recibir" / "Historial", con botón "Confirmar recepción" que
  abre un modal para el comentario opcional.
- Sigue el patrón visual ya establecido (header unificado, tabla con
  toolbar, modal con `max-h-[92vh] flex flex-col overflow-hidden`).

**`src/InventarioProductos.jsx`**
- Sin cambios estructurales; se beneficia automáticamente de que
  `crearProducto` ahora siembra las 5 sucursales.

## Casos borde

1. **Producto ya existente antes de este cambio, sin fila de existencia en
   alguna sucursal:** al recibir un traspaso hacia esa sucursal, si no existe
   la fila, `recibirTraspaso` la crea (cantidad_minima/maxima en 0). Así no
   hace falta una migración retroactiva de los productos ya creados.
2. **Traspaso hacia MercadoLibre (sucursal 5):** se trata igual que cualquier
   otra sucursal destino; no hay lógica especial de sincronización con
   publicaciones ML en este alcance (queda fuera).
3. **Cancelar un traspaso en tránsito:** no está pedido — fuera de alcance.
   Si se necesita corregir un error, por ahora se resuelve con un ajuste
   manual de existencia (ya existe) en origen y destino.
4. **Un usuario amarrado intenta recibir un traspaso que no es para su
   sucursal:** rechazado (403/400) — la validación de
   `sucursal_destino_id === sucursalUsuarioId` lo bloquea.

## Estrategia de pruebas

- `crearProducto` siembra existencia en las 5 sucursales, con la cantidad
  inicial en la sucursal correcta y 0 en las demás.
- `crearTraspaso` descuenta de origen de inmediato y rechaza si no hay
  existencia suficiente.
- `recibirTraspaso` abona exactamente la cantidad enviada a destino, crea la
  fila de existencia si no existía, guarda el comentario de recepción sin
  alterar la cantidad, y rechaza si lo intenta confirmar alguien de otra
  sucursal.
- `listarTraspasos` para un usuario amarrado incluye traspasos donde su
  sucursal es origen o destino, no otros.
- Integración end-to-end: crear producto → traspasar → confirmar recepción →
  verificar existencia final en ambas sucursales y el historial de
  `movimientos_inventario`.
