# Garantías — Design Spec

## Contexto

Victor detectó tres fugas reales en el manejo de garantías con proveedor:

1. Un producto defectuoso queda en la tienda porque el personal no avisa que hay que tramitarlo — con el tiempo se termina registrando como merma en vez de como garantía recuperable.
2. El producto se envía (a veces directo al proveedor, a veces vía CEDIS) pero nadie le da seguimiento, y se pierde en el camino.
3. El proveedor resuelve pero se le olvida regresar el producto (reparado, reemplazo, etc.).
4. Cuando algo sí llega de vuelta, ya nadie sabe de qué tienda salió originalmente.

Hoy no existe ningún módulo de Garantías en el sistema — es una pieza nueva. El diseño reutiliza patrones ya validados en el repo: la bitácora de movimientos de **Apartados** (`apartado_abonos`), el ciclo de estados con botones explícitos de **Traspasos**/**Recepción de Compras**, y el ajuste de existencia de `productos.js`.

## Objetivo

1. Registrar una garantía en cuanto se detecta el producto defectuoso — con o sin cliente de por medio (cliente devolviendo una venta, o stock propio dañado sin que haya intervenido ningún cliente).
2. Trackear el envío con destino variable: directo a proveedor, o vía CEDIS primero — sin perder de vista en ningún momento de qué tienda salió originalmente.
3. Registrar la resolución del proveedor: reparado, reemplazo, cambio de componente (con costo opcional si no es gratis), rechazada, o nota de crédito/reembolso.
4. Cuando hay producto físico de regreso, reintegrarlo a existencia de la tienda de origen; si el caso tiene cliente ligado, un último paso de entrega antes de cerrar.
5. Alertar visualmente cuando una garantía lleva demasiado tiempo sin movimiento (umbral configurable), para que nadie se pierda en el camino sin que alguien se dé cuenta.

## Fuera de alcance

- Integración con el aviso de CRM (como el de Apartados por vencer) — el aviso vive solo dentro de la pantalla de Garantías por ahora; se puede agregar después si hace falta.
- Notificaciones automáticas al proveedor (email/WhatsApp).
- Adjuntar fotos/evidencia del defecto.
- Permisos separados por paso del ciclo — un solo permiso (`gestionar_garantias`) cubre registrar, enviar, actualizar ubicación, resolver, recibir y entregar.
- Reporte dedicado de Garantías dentro de Reportes del Sistema — la pantalla de Garantías es la única fuente por ahora.

## Diseño

### 1. Modelo de datos

Dos colecciones nuevas bajo `DB.inventario` (mismo namespace que `existencias`/`movimientos_inventario`, ya que el impacto principal es de inventario):

**`DB.inventario.garantias`** — un renglón por caso:
- `id`, `folio` (autogenerado, ej. `G-0001`)
- `sucursal_origen_id` — obligatorio, de qué tienda salió. Es el dato que nunca se pierde, sin importar cuántos saltos tenga el caso.
- `producto_id` — obligatorio, referencia al catálogo.
- `cliente_id` — opcional (`null` si es stock propio sin cliente).
- `venta_id` — opcional, si el caso viene ligado a una venta ya registrada.
- `proveedor_id` — opcional al crear; se puede definir al marcar Enviada o después.
- `estado`: `"registrada"` → `"enviada"` → `"resuelta"` → (`"en_tienda_pendiente_entrega"` solo si hay cliente) → `"cerrada"`.
- `ubicacion_actual` — texto corto libre (ej. `"Tienda Ocosingo"`, `"CEDIS"`, `"Proveedor XYZ"`), se actualiza en cada movimiento.
- `tipo_resolucion`: `null` | `"reparado"` | `"reemplazo"` | `"cambio_componente"` | `"rechazada"` | `"nota_credito"`.
- `costo_resolucion`: `null` | número — monto que cobra el proveedor cuando `tipo_resolucion` es `"reparado"`/`"reemplazo"`/`"cambio_componente"` y no es gratis (`null` = gratis). No aplica a `"rechazada"` (no hay cargo) ni a `"nota_credito"` (el monto del crédito, si se necesita registrar estructurado más adelante, queda fuera de alcance de este MVP — por ahora va en `notas_resolucion` como texto libre).
- `notas_resolucion`.
- `fecha_creacion`, `fecha_ultimo_movimiento` (se actualiza en cada push a la bitácora; es la base del cálculo de días sin seguimiento).
- `usuario_creacion`.

**`DB.inventario.garantia_movimientos`** — bitácora (mismo patrón que `apartado_abonos`): `id`, `garantia_id`, `fecha`, `usuario`, `tipo` (`creacion` / `envio` / `actualizacion_ubicacion` / `resolucion` / `recepcion` / `entrega_cliente`), `descripcion` (texto libre, ej. "Enviada a CEDIS", "CEDIS reenvía a Proveedor XYZ", "Resuelta: reemplazo, costo $150"). Esto es lo que resuelve el problema de "no saben de qué tienda es" — el historial completo queda visible sin importar la ruta que tomó el producto.

### 2. Backend — `backend/garantias.js` (nuevo módulo)

Mismo patrón que `apartados.js`: recibe `DB` y muta objetos planos. **Cada función mutadora valida `dentroDeAlcance(garantia.sucursal_origen_id, alcance)` antes de actuar** — el mismo guard que faltó en Apartados y se tuvo que corregir después en auditoría; aquí se construye desde el día uno.

```
crearGarantia(DB, datos, sucursalId, usuario)
```
- Valida `producto_id` existente. `cliente_id`/`venta_id` opcionales.
- Crea el registro con `estado: "registrada"`, `ubicacion_actual` = nombre de la sucursal de origen.
- Push del primer movimiento (`tipo: "creacion"`).

```
marcarEnviada(DB, id, { destino_tipo, destino_nombre, proveedor_id }, usuario, alcance)
```
- Válido solo si `estado === "registrada"`.
- Descuenta 1 pieza de existencia de `sucursal_origen_id` vía `ajustarExistencia(DB, producto_id, { cantidad: -1, motivo: "Garantía " + folio + " — enviada", sucursal_id })` (mismo mecanismo que Traspasos).
- Cambia `estado` a `"enviada"`, `ubicacion_actual` = `destino_nombre`. Push movimiento (`tipo: "envio"`).

```
actualizarUbicacion(DB, id, { ubicacion_actual, notas }, usuario, alcance)
```
- Válido solo si `estado === "enviada"`. No cambia de estado — es para los casos que dan más de un salto (ej. CEDIS reenvía al proveedor). Push movimiento (`tipo: "actualizacion_ubicacion"`), actualiza `ubicacion_actual` y `fecha_ultimo_movimiento`.

```
registrarResolucion(DB, id, { tipo_resolucion, costo_resolucion, notas }, usuario, alcance)
```
- Válido solo si `estado === "enviada"`.
- Si `tipo_resolucion` es `"rechazada"` o `"nota_credito"` (no hay producto físico de regreso): cambia `estado` directo a `"cerrada"`.
- Si es `"reparado"` / `"reemplazo"` / `"cambio_componente"`: cambia `estado` a `"resuelta"` (espera a `recibirEnTienda`).
- Push movimiento (`tipo: "resolucion"`).

```
recibirEnTienda(DB, id, usuario, alcance)
```
- Válido solo si `estado === "resuelta"`.
- Reintegra existencia vía `ajustarExistencia(DB, producto_id, { cantidad: +1, motivo: "Garantía " + folio + " — recibida", sucursal_id: sucursal_origen_id })`.
- Si `cliente_id` existe: `estado` → `"en_tienda_pendiente_entrega"`. Si no: `estado` → `"cerrada"` directo (reingresa a inventario disponible para venta).
- Push movimiento (`tipo: "recepcion"`).

```
entregarACliente(DB, id, usuario, alcance)
```
- Válido solo si `estado === "en_tienda_pendiente_entrega"`. Cambia a `"cerrada"`. Push movimiento (`tipo: "entrega_cliente"`).

```
listarGarantias(DB, alcance)
```
- Filtra por `sucursal_origen_id` según alcance (igual que `listarApartados`). Agrega a cada fila `dias_sin_movimiento` (hoy − `fecha_ultimo_movimiento`) y `atrasada: dias_sin_movimiento > config.dias_alerta_garantias`.

### 3. Configuración — `backend/configuracion.js`

Se agrega `dias_alerta_garantias: 15` a `CONFIG_DEFAULT` (mismo patrón que `dias_seguimiento_postventa`), editable desde la pantalla de Configuración ya existente.

### 4. Frontend

**Dashboard.jsx**: nuevo tile "Garantías" (`{ id: "garantias", nombre: "Garantías", icono: ShieldAlert, disponible: true, modulo: "inventario", permiso: "gestionar_garantias" }`) — mismo nivel que Traspasos, no anidado dentro de otra pantalla.

**`src/Garantias.jsx`** (nueva pantalla): tabla (folio, producto, sucursal origen, cliente si aplica, estado, ubicación actual, días sin movimiento con badge rojo si `atrasada`), con filtro "Solo atrasadas" y filtro por estado.

- **Nueva Garantía**: modal con buscador de producto (mismo componente que ya usan Traspasos/POS), selector de cliente opcional (buscador de clientes existente), campo opcional de folio de venta, notas del defecto.
- Acciones por fila, según `estado` — mismo criterio "botón por botón" que Traspasos/Apartados:
  - `registrada` → **Marcar Enviada** (radio Proveedor directo / CEDIS + selector de proveedor si aplica).
  - `enviada` → **Actualizar Ubicación** (texto libre) y **Registrar Resolución** (selector de tipo + campo de costo condicional si el tipo lo admite + notas).
  - `resuelta` → **Recibir en Tienda**.
  - `en_tienda_pendiente_entrega` → **Entregar a Cliente**.
  - `cerrada` → sin acciones, solo lectura del historial.

Rutas nuevas en `server.js`, todas con `requierePermiso("gestionar_garantias", resolverPermisosDeRol)` y alcance vía `alcanceSucursal`/`dentroDeAlcance`:
`POST /api/garantias`, `GET /api/garantias`, `PUT /api/garantias/:id/enviar`, `PUT /api/garantias/:id/ubicacion`, `PUT /api/garantias/:id/resolucion`, `PUT /api/garantias/:id/recibir`, `PUT /api/garantias/:id/entregar-cliente`.

### 5. Permisos

Nuevo permiso `gestionar_garantias` (módulo `inventario`, mismo módulo que `realizar_traspasos`/`recibir_compra` — no hace falta tocar `MODULOS_SISTEMA` ni `validarPermisos.js`), registrado en `permisosCatalogo.js`. Cubre las 6 acciones del ciclo completo.

## Testing

- `backend/garantias.test.js`: ciclo completo con y sin cliente; que rechazada/nota_credito cierra directo sin pasar por `recibirEnTienda`; que `marcarEnviada` descuenta existencia y `recibirEnTienda` la reintegra (salvo rechazada/nota_credito, que nunca la reintegra); que cada función mutadora respeta `dentroDeAlcance` (un usuario de otra sucursal no puede actuar sobre una garantía ajena); cálculo de `dias_sin_movimiento`/`atrasada` contra el umbral configurable.
- Frontend: sin arnés de pruebas automáticas (convención ya establecida en el repo) — verificación manual en navegador del flujo completo (con cliente y sin cliente, destino proveedor directo y vía CEDIS, cada tipo de resolución).
