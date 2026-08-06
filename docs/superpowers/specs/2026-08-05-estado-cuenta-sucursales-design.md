# Estado de Cuenta entre Sucursales — Diseño

**Fecha:** 2026-08-05
**Estado:** Aprobado por Victor (brainstorming), pendiente de plan de implementación.

## Objetivo

Saber en cualquier momento **quién le debe al bote común y quién puso de más**. Todas las tiendas depositan a una cuenta común; el CEDIS compra con ese dinero y reparte la mercancía a cada tienda. Hoy el sistema ya sabe qué mercancía recibió cada tienda (traspasos) y a qué costo (compras), pero **no captura los depósitos** de cada tienda a la cuenta común. Ese es el único dato que falta para cruzar el saldo.

## Decisiones (confirmadas con Victor)

1. **Cuenta común centralizada en el CEDIS (modelo A).** El saldo de cada tienda es contra el bote común, no entre tiendas directamente. No hay préstamos tienda-a-tienda ni depósitos "etiquetados" para otra tienda.
2. **La mercancía recibida se valúa a COSTO** (no a precio de venta): la tienda "consume" del bote exactamente lo que costó. Cada traspaso nuevo guarda una **foto del costo** del producto al momento de enviarse; los traspasos viejos usan el costo actual como aproximación.
3. **Saldo corriente (acumulado)**, con filtro de fechas para revisar movimientos. No hay cierre por periodo (se puede agregar después si se necesita).
4. **Comprobante opcional.** El monto y la fecha son obligatorios; la ficha bancaria se puede adjuntar (se sube a Drive con la compresión de imagen ya existente) pero **nunca bloquea** el registro aunque Drive esté caído.
5. **Captura por tienda, vista central.** Cada cajera captura y ve los depósitos y el saldo **de su tienda** (alcance de sucursal). La administración ve **todas** las tiendas y puede filtrar por una. Esta diferencia la resuelve el permiso ya existente `ver_todas_las_sucursales` (el mismo alcance de todos los reportes), no un permiso nuevo.

## Enfoque

El saldo se **calcula al vuelo** desde los depósitos y los traspasos cada vez que se abre la pantalla, igual que los reportes de `reportes.js`. No se guarda ningún "saldo" en la base que pueda desincronizarse: la fuente única de verdad son los movimientos. Los volúmenes son pequeños, así que es instantáneo.

## Modelo de datos

### Colección nueva: `DB.cuenta_comun`

Siguiendo el patrón de `DB.gastos` (llave de módulo propia con su contador síncrono):

```
DB.cuenta_comun = {
  depositos: [],            // los depósitos capturados
  deposito_movimientos: [], // bitácora (creado / cancelado)
  ultimo_id: 0,             // contador SÍNCRONO de folios (ver "folio")
}
```

**Registro de depósito:**

| Campo | Tipo | Nota |
|---|---|---|
| `id` | number | del contador síncrono |
| `folio` | string | `DEP-0001` |
| `sucursal_id` | number | de la sucursal del usuario que captura (no se elige libre) |
| `monto` | number | > 0 |
| `fecha` | string `YYYY-MM-DD` | **fecha local de la tienda** (`fechaLocal()`) |
| `fecha_hora` | string ISO UTC | instante de captura (`ahora()`) |
| `forma_pago` | string | `EFECTIVO` \| `TRANSFERENCIA` |
| `referencia` | string | folio/referencia bancaria, opcional |
| `nota` | string | opcional |
| `comprobante` | objeto \| null | archivo en Drive (id, link), **opcional** |
| `usuario_id`, `usuario_nombre` | | quién capturó |
| `estatus` | string | `activo` \| `cancelado` |
| `motivo_cancelacion` | string \| null | |

**Folio síncrono (lección del bug CRITICAL de Gastos):** el `id` y el `folio` se reservan del contador `DB.cuenta_comun.ultimo_id` **de forma síncrona, sin ningún `await` entre leer y escribir**, y el `push` ocurre antes de la subida a Drive. La subida del comprobante (que sí tiene `await`) se hace después, y su resultado se adjunta al registro ya creado. Así dos capturas concurrentes nunca reciben el mismo folio.

### Modificación a traspasos: `costo`

`traspasos.js -> crearTraspaso` agrega `costo` al registro del traspaso: una foto de `producto.costo` (de `DB["catalogo-productos"].productos`) al momento de enviarse. Para valuar la mercancía recibida se usa `cantidad × (traspaso.costo ?? costo_actual_del_producto)`, con el costo actual como respaldo para traspasos viejos que no tengan la foto.

## El cálculo del estado de cuenta

`estadoCuenta(DB, { fecha_inicio, fecha_fin, sucursal_id }, alcance)`:

Por cada sucursal visible dentro del `alcance`:
- **Depositado** = suma de `monto` de los depósitos **activos** de esa sucursal cuya `fecha` cae en el rango.
- **Recibido** = suma de `cantidad × costo` de los traspasos con `sucursal_destino_id` = esa sucursal, **estatus `recibido`** (no cuenta lo que está `en_transito`), cuya fecha de recepción cae en el rango.
- **Saldo** = Depositado − Recibido. Positivo = puso de más (a favor); negativo = le debe al bote común.

Devuelve: resumen por sucursal (`{ sucursal_id, sucursal_nombre, depositado, recibido, saldo }`) y, cuando se pide una sola sucursal, el **detalle de movimientos** (depósitos y traspasos recibidos, ordenados por fecha) para ver de dónde sale el saldo.

**CEDIS (sucursal 6) es el centro, no un deudor:** es el origen de los traspasos, no el destino, así que no aparece como tienda con saldo. MercadoLibre (sucursal 5) aparece solo si tiene depósitos o traspasos recibidos.

## Backend

- **`backend/depositos.js` (nuevo):** `crearDeposito` / `listarDepositos` / `cancelarDeposito`, siguiendo el patrón de `gastos.js`: folio síncrono, guard de alcance **dentro del módulo** (`dentroDeAlcance`), cancelar sin borrar (motivo obligatorio, deja bitácora), y al cancelar borra también el comprobante de Drive.
- **`backend/estadoCuenta.js` (nuevo):** `estadoCuenta(DB, filtros, alcance)` como arriba. Se mantiene aparte de `reportes.js` porque es un dominio propio (cuenta común), no uno de los reportes de venta.
- **`backend/traspasos.js` (modificar):** foto de `costo` en `crearTraspaso`.
- **`backend/drive.js` (reusar):** carpeta raíz nueva "Comprobantes de Depósitos", subcarpeta por sucursal (patrón de `asegurarCarpetaGastosSucursal`).

### Permisos — módulo `cuenta_comun` (regla: cada botón, su permiso)

Registrar en `permisosCatalogo.js` (`MODULOS_SISTEMA`, `MODULOS_QUE_REQUIEREN_PERMISOS`) y en `validarPermisos.js`. `reconciliarRoles()` los agrega solo al rol Administrador en el arranque; los demás roles Victor los habilita a mano en Roles y Personal.

| Permiso | Botón / acción |
|---|---|
| `ver_estado_cuenta` | Abrir la pantalla y ver el estado de cuenta |
| `registrar_depositos` | Botón "Registrar depósito" |
| `cancelar_depositos` | Botón "Cancelar" de un depósito |

Cada ruta usa su permiso propio (no prestado de otro módulo). La diferencia "ver solo mi tienda" (cajera) vs "ver todas / filtrar" (administración) la da el permiso existente `ver_todas_las_sucursales` vía `alcanceSucursal`, igual que en los reportes.

### Rutas REST

- `POST /api/depositos` — `registrar_depositos` (sucursal tomada del token del usuario).
- `GET /api/depositos` — `ver_estado_cuenta` (con alcance).
- `PUT /api/depositos/:id/cancelar` — `cancelar_depositos` (con guard de alcance sobre `sucursal_id` del depósito).
- `GET /api/estado-cuenta` — `ver_estado_cuenta` (con alcance; acepta `fecha_inicio`, `fecha_fin`, `sucursal_id`).

## Frontend

- **Tile nuevo en el Dashboard:** "Estado de Cuenta" (gateado por `ver_estado_cuenta`).
- **Pantalla `src/EstadoCuenta.jsx`:**
  - **Captura de depósito** (botón gateado por `registrar_depositos`): monto, forma de pago, referencia, nota y comprobante opcional (con `comprimirImagen` ya existente). La sucursal es la del usuario, no se elige.
  - **Cajera** (usuario amarrado a sucursal): ve la lista de sus depósitos y **su saldo** (depositado − recibido de su tienda). El botón "Cancelar" de cada depósito se gatea por `cancelar_depositos`.
  - **Administración** (con `ver_todas_las_sucursales`): tabla resumen de todas las tiendas (Depositado / Recibido / Saldo), filtro por tienda y por fechas, y detalle de movimientos al elegir una tienda. Export CSV con el helper endurecido `descargarCSV` (RFC 4180 + BOM + anti-inyección) ya existente.

## Bordes y manejo de errores

- `monto` debe ser > 0; `forma_pago` dentro del catálogo; `sucursal_id` del token, nunca del body.
- Fechas: `fecha` del depósito y los filtros usan la **fecha local de la tienda** (`backend/fechas.js` / `src/fechas.js`), no UTC.
- Cancelar un depósito **no lo borra** (estatus `cancelado` + motivo obligatorio + bitácora); borra también el comprobante en Drive si lo tenía.
- Solo cuentan traspasos **recibidos**; los `en_transito` no suman al "recibido".
- Traspasos viejos sin `costo`: se valúan con el costo actual del producto y la fila lo marca como **aproximado** (o nota al pie), para que Victor sepa que ese renglón no es una foto exacta.
- Guard de alcance: la cajera solo registra/cancela/ve lo de su sucursal; la administración ve todas / filtra.

## Pruebas (backend, `node --test`)

- **`depositos.test.js`:** crear (monto > 0, folio síncrono probado con capturas concurrentes, sucursal del token); cancelar (no borra, motivo obligatorio, borra comprobante); guard de alcance (una cajera no cancela el depósito de otra sucursal por folio — el bug tipo Apartados).
- **`estadoCuenta.test.js`:** saldo = depositado − recibido; un traspaso `recibido` cuenta y uno `en_transito` NO; valuación a costo con la foto del traspaso y respaldo al costo actual cuando falta; alcance por sucursal (gerente amarrado pidiendo `?sucursal_id=` de otra tienda no la ve); filtro por **fecha local** (un depósito de las 8pm cae en el día de la tienda, no en el de UTC); CEDIS no aparece como deudor.
- **`traspasos` (ampliar):** `crearTraspaso` guarda la foto de `costo`.
- **Permisos:** una prueba de que las rutas exigen el permiso propio (`registrar_depositos` / `ver_estado_cuenta` / `cancelar_depositos`), como las demás pruebas de permiso del repo.

## Fuera de alcance (YAGNI)

- Cierre formal por periodo (el saldo es corriente; se agrega después si se pide).
- Préstamos directos tienda-a-tienda o depósitos etiquetados para otra tienda (el modelo es centralizado en CEDIS).
- Conciliación bancaria automática o lectura de la ficha por IA.
- Que la administración registre depósitos por otra tienda (por ahora cada tienda captura lo suyo; se puede ampliar si hace falta).
