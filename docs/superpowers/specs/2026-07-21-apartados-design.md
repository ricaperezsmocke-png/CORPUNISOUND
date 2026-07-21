# Apartados — Design Spec

## Contexto

Victor pidió agregar al Punto de Venta un apartado (layaway): el cliente paga un anticipo, el producto se reserva, y viene después a liquidar el resto (en uno o varios abonos) antes de llevárselo. Hoy no existe nada parecido — `TIPOS_DOCUMENTO` en `PuntoDeVenta.jsx` no incluye "Apartado", y no hay ningún concepto de pago parcial en el sistema (el permiso `aplicar_abonos_clientes` existe en el catálogo pero está marcado `implementado: false`).

Esta es la primera vez que el sistema necesita una libreta de pagos parciales reales. Se decidió construirla acotada a Apartados (no el CRM de crédito general), reutilizando al máximo la tabla de ventas existente en vez de crear un documento paralelo.

## Objetivo

1. Desde el Punto de Venta, con productos ya en el carrito, crear un apartado: exige cliente real (no "Público en General"), anticipo > $0, descuenta existencia de inmediato, fija un límite de 60 días.
2. Permitir abonar (pagos parciales adicionales) y liquidar (cuando el saldo llega a $0) desde una pantalla de Lista de Apartados, dentro de un modal del POS.
3. Si nadie liquida ni cancela en 60 días, el sistema automáticamente: regresa el producto a existencia, cancela el apartado, y abona lo ya pagado al `monedero` electrónico del cliente. Cancelar a mano hace lo mismo.
4. Cada abono (incluido el anticipo) cuenta como efectivo real el día que se paga — el Corte de Caja y el Reporte de Movimientos de Caja deben cuadrar sin duplicar dinero cuando el apartado se liquide después.
5. Un apartado liquidado aparece en Reporte de Ventas y Utilidad como una venta cerrada más (fechada el día que se apartó, con una columna adicional de fecha de liquidación), filtrable por tipo de documento ("Apartado" vs "Ticket" etc.) para poder aislarlo del resto.
6. Reporte de Ventas gana una pestaña "Abonos" con el detalle de cada pago parcial (fecha, folio, cliente, monto, forma de pago) — es la fuente real del desglose por forma de pago de los apartados, ya que un apartado puede pagarse con formas de pago distintas en cada abono.
7. Reporte de Estado de Cuenta de Clientes gana una columna "Monedero".
8. CRM avisa cuando un apartado está por vencer (≤7 días), con botón "Ya contacté" (mismo patrón que el aviso de seguimiento postventa que ya existe).

## Fuera de alcance

- Configurar el límite de 60 días o el umbral de aviso (7 días) — quedan fijos en código, no en Configuración.
- Permisos separados para crear/abonar/liquidar/cancelar — un solo permiso `gestionar_apartados` cubre las 4 acciones.
- Historial de abonos a crédito de clientes en general (`aplicar_abonos_clientes`) — sigue sin implementarse; esta libreta de abonos es específica de Apartados.
- Notificaciones automáticas (SMS/WhatsApp/email) al cliente — el aviso vive solo dentro del sistema (CRM).

## Diseño

### 1. Modelo de datos

Un apartado es una fila más en `DB.pos.ventas` (misma tabla que las ventas normales), con:
- `tipo_documento: "Apartado"`
- `estatus`: `"apartado"` (vigente, con saldo pendiente) → `"cerrada"` (liquidado) o `"cancelada"` (cancelado o vencido) — mismo campo que ya existe, con un valor nuevo.
- `fecha`: día en que se apartó (igual que hoy, se usa para filtrar/agrupar en reportes).
- `fecha_limite`: `fecha` + 60 días.
- `fecha_liquidacion`: `null` hasta que se liquide.
- `metodo_pago`: se guarda como `"MIXTO"` (un apartado puede pagarse con formas de pago distintas en cada abono; el desglose real vive en los abonos, no aquí).
- `cliente_id`: obligatorio, no puede ser `0` (Público en General) — se necesita poder contactarlo y, si aplica, abonarle a su monedero.

`venta_detalle` se llena igual que en una venta normal (mismas líneas del carrito al momento de apartar), y `ajustarExistencia` descuenta inventario de inmediato — mismo mecanismo que ya usa `crearVenta`.

Nueva colección `DB.pos.apartado_abonos`: cada pago (el anticipo es el primer abono) con `id`, `venta_id`, `fecha`, `monto`, `forma_pago`, `usuario_nombre`. El saldo pendiente siempre se calcula como `total - suma(monto de sus abonos)`.

### 2. Backend — `backend/apartados.js` (nuevo módulo)

Mismo patrón que `ventas.js`/`compras.js`: recibe `DB` y regresa/mutan objetos planos.

```
crearApartado(DB, datos, sucursalId, usuario)
```
- Valida: `cliente_id` presente y distinto de 0; al menos una línea; anticipo (`datos.anticipo_monto`) > 0; `datos.anticipo_forma_pago` presente.
- Reutiliza la misma validación de existencia suficiente que `crearVenta` (no permitir apartar más de lo disponible, salvo que `permitir_ventas_sin_existencia` esté activo).
- Crea la venta con `estatus: "apartado"`, `tipo_documento: "Apartado"`, `metodo_pago: "MIXTO"`, `fecha_limite` = hoy + 60 días.
- Llena `venta_detalle` y descuenta existencia por cada línea (igual que `crearVenta`).
- Push del primer abono (el anticipo) a `apartado_abonos`.
- Devuelve la venta creada.

```
registrarAbono(DB, ventaId, { monto, forma_pago }, usuario)
```
- La venta debe existir, tener `estatus: "apartado"`. `monto` > 0 y ≤ saldo pendiente actual (no se puede sobrepagar).
- Push a `apartado_abonos`. Si el nuevo total abonado ≥ `venta.total`: llama a `liquidarApartado` internamente.

```
liquidarApartado(DB, ventaId)
```
- Cambia `estatus` a `"cerrada"`, fija `fecha_liquidacion` a hoy. No toca existencia (ya se descontó al crear).

```
cancelarApartado(DB, ventaId, motivo)
```
- Cambia `estatus` a `"cancelada"`, `motivo_cancelacion`. Reintegra existencia de cada línea (`ajustarExistencia` positivo, igual que `cancelarVenta`). Abona el total ya pagado (`suma de sus apartado_abonos`) al campo `monedero` del cliente.

```
procesarVencimientos(DB)
```
- Recorre `DB.pos.ventas` con `estatus: "apartado"` y `fecha_limite < hoy`; para cada una llama a `cancelarApartado(DB, venta.id, "Vencido — 60 días sin liquidar")`. Se llama al inicio de `listarApartados` (lazy, sin necesidad de un cron) — mismo patrón que ya usan `calcularCorteEnCurso`/`reconciliarRoles` para mantener estado consistente sin infraestructura de tareas programadas.

```
listarApartados(DB, alcance)
```
- Llama primero a `procesarVencimientos(DB)`. Devuelve las ventas con `tipo_documento: "Apartado"` (filtradas por alcance de sucursal), con `saldo_pendiente`, `dias_restantes`, y sus `abonos`.

```
obtenerApartadosProximosAVencer(DB, alcance)
```
- Mismo patrón que `obtenerSeguimientosPostventaPendientes` en `crm.js`: apartados con `estatus: "apartado"` y `dias_restantes <= 7`, que no tengan ya un contacto registrado (`DB.crm.contactos_cliente` con `tipo: "apartado_por_vencer"` y `venta_id` igual). Se llama después de `procesarVencimientos`.

**Guard en `cancelarVenta` (ventas.js) existente:** si `venta.tipo_documento === "Apartado"`, la ruta `PUT /api/ventas/:id/cancelar` debe delegar a `cancelarApartado` (para no perder el abono al monedero) en vez de a `cancelarVenta` normal.

### 3. Corte de Caja y Movimientos de Caja — la parte delicada

**El problema:** un apartado se paga en varias fechas y formas de pago distintas a lo largo de hasta 60 días. Si el Corte de Caja y el Reporte de Movimientos de Caja siguieran sumando `venta.total` (como hacen hoy para ventas normales), el dinero se contaría en el corte del día de la LIQUIDACIÓN — pero ese dinero, en la práctica, ya se fue contando corte a corte conforme se recibía cada abono. Sumar también el total completo al liquidar sería contarlo dos veces.

**La solución:** para ventas con `tipo_documento === "Apartado"`, ni `calcularCorteEnCurso` (`cortes.js`) ni `reporteMovimientosCaja` (`reportes.js`) deben sumar `venta.total` en absoluto — en su lugar, ambos suman los renglones de `DB.pos.apartado_abonos` cuya `fecha` cae dentro del rango correspondiente (desde el último corte, o el rango de fechas del reporte), agrupados por `forma_pago`. Esto aplica a TODOS los abonos de TODOS los apartados (vigentes, liquidados o cancelados) — el dinero que entró, entró, sin importar qué pasó después con el apartado.

Ventas normales (Ticket, Factura, etc.) siguen exactamente igual que hoy: se paga completo el mismo día, así que `venta.total` por `metodo_pago` sigue siendo correcto para ellas.

### 4. Reportes — cambios en `backend/reportes.js`

- **`reporteVentas`**: el filtro de "vigentes" pasa de `estatus !== "cancelada"` a `estatus === "cerrada"` (así un apartado con `estatus: "apartado"` — todavía con saldo pendiente — no se cuenta como venta cerrada hasta que se liquide; no aparece en ningún lado del reporte mientras está pendiente). Se agrega:
  - Filtro nuevo `tipo_documento` (ya lo acepta la función, pero hoy no se expone en el frontend — se agrega un selector "Documento: Todos / Ticket / Apartado / ..." en `ReporteVentas.jsx`).
  - Campo `fecha_liquidacion` en cada fila de `general` (null para ventas normales).
  - Nueva pestaña **Abonos**: lista `DB.pos.apartado_abonos` cuya `fecha` cae en el rango, con folio de la venta, nombre del cliente, monto y forma de pago — sin importar el estado actual del apartado.
- **`reporteUtilidad`**: mismo ajuste, `estatus === "cerrada"` en vez de `!== "cancelada"`.
- **`reporteMovimientosCaja`**: entradas excluye `tipo_documento === "Apartado"` de la suma por ventas, y agrega los `apartado_abonos` del rango como entradas adicionales agrupadas por `forma_pago` (ver sección 3).
- **`reporteEstadoCuentaClientes`**: agrega `monedero` a cada fila de `filas` (ya existe el campo en `DB.crm.clientes`).

### 5. Frontend — Punto de Venta

Nuevo botón lateral "Apartados" (`Alt+P`, mismo patrón que `BotonLateral` de Cotización/Espera), abre un modal ancho (`max-w-4xl`) con 2 pestañas:

- **Nuevo Apartado**: usa el `carrito` actual tal cual está (mismas líneas que se enviarían a `POST /api/ventas`), exige `cliente.id !== 0` (si el cliente actual es Público en General, pide seleccionar uno real primero), captura anticipo (monto + forma de pago del mismo catálogo `FORMAS_CORTE`/condiciones de pago que ya usa el cobro normal). Al confirmar: `POST /api/apartados`, limpia el carrito.
- **Lista de Apartados**: tabla de apartados vigentes de la sucursal (folio, cliente, total, saldo pendiente, días restantes — resaltado en ámbar si quedan ≤7 días). Un apartado que ya rebasó los 60 días nunca se ve "vencido" en esta lista: `listarApartados` corre `procesarVencimientos` antes de devolver los datos, así que ya se canceló y desapareció de los vigentes desde antes de mostrarse. Acciones por fila: **Abonar** (modal chico: monto + forma de pago), **Liquidar** (solo habilitado si saldo pendiente es $0), **Cancelar** (motivo opcional, confirma con el mismo texto de advertencia que ya usa cancelar venta).

Rutas nuevas: `POST /api/apartados`, `GET /api/apartados`, `POST /api/apartados/:id/abonos`, `PUT /api/apartados/:id/cancelar` — todas protegidas con `requierePermiso("gestionar_apartados", resolverPermisosDeRol)`.

### 6. CRM — aviso de apartados por vencer

Mismo patrón que el aviso de seguimiento postventa ya existente en `src/CRM.jsx` (`postventaPendientes`):
- Nuevo estado `apartadosPorVencer`, cargado desde `GET /api/crm/apartados-por-vencer` (llama a `obtenerApartadosProximosAVencer`).
- Banner en la parte superior de CRM (mismo estilo visual que el de postventa), con badge de conteo en el encabezado.
- Botón **"Ya contacté"** por cada uno: `POST /api/crm/clientes/:id/contactos` con `tipo: "apartado_por_vencer"` y `venta_id`, igual que `registrarPostventa` — al registrar el contacto, desaparece de la lista aunque el apartado siga vigente (no se vuelve a repetir el aviso salvo que created uno nuevo).

### 7. Permisos

Nuevo permiso `gestionar_apartados` (módulo `pos`), registrado en `permisosCatalogo.js` (ya existe el módulo `pos`, no hace falta tocar `validarPermisos.js` ni `MODULOS_SISTEMA`).

## Testing

- `backend/apartados.test.js`: crear apartado (validaciones de cliente/anticipo/existencia), abonar (rechaza sobrepago, liquida automático al llegar a $0), cancelar (reintegra existencia + abona monedero), vencimiento automático a los 60 días (mismo comportamiento que cancelar), `obtenerApartadosProximosAVencer` (respeta el umbral de 7 días y el contacto ya registrado).
- `backend/reportes.test.js`: nuevas pruebas para el filtro `tipo_documento` en `reporteVentas`, la pestaña Abonos, que un apartado pendiente NO cuenta en "vigentes", que Corte de Caja/Movimientos de Caja no duplican dinero entre abonos y liquidación.
- `backend/cortes.test.js` (o el archivo de pruebas de cortes existente): que los abonos de apartados se sumen al calculado del corte y que la venta del apartado NO se sume por separado.
- Frontend: sin arnés de pruebas automáticas (convención ya establecida) — verificación manual en navegador del flujo completo (apartar → abonar → liquidar, y apartar → cancelar/vencer → monedero acreditado), y del aviso en CRM.
