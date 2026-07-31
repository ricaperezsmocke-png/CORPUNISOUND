# Módulo de Gastos — Diseño (Fase 1)

**Fecha:** 2026-07-31
**Estado:** Aprobado por Victor, listo para plan de implementación.

## Objetivo

Registrar, clasificar y respaldar **cada salida de dinero que no sea mercancía**, para responder la pregunta de Victor: *"¿en qué se está gastando?"* — por sucursal, categoría y periodo.

Vive junto a Corte de Caja, porque la forma de pago dominante en la operación real es **efectivo de la caja de la tienda**.

## Contexto y hallazgos que motivan el diseño

- **Hoy no existe ningún registro de gastos.** La única salida de dinero que el sistema conoce es `corte.retiro` (dinero que se guarda al cerrar turno), que no tiene concepto, categoría, proveedor ni comprobante. Los gastos de garantía (`DB.inventario.garantia_gastos`) son un caso aparte y específico del módulo de Garantías.
- **Bug real que este módulo corrige:** `calcularCorteEnCurso` (`backend/cortes.js`) calcula el efectivo esperado únicamente con ventas y abonos del turno. Si la cajera saca $500 de la caja para pagar el garrafón, al contar el dinero faltan $500 y el sistema lo reporta como **diferencia negativa** — indistinguible de un faltante o un robo. Las diferencias de caja del negocio llevan meses contaminadas con gastos legítimos.
- **La mercancía queda fuera a propósito.** Ya se registra en Recepción de Compras (sube existencia y recalcula costo). Además, en la operación real de Victor la compra es **conjunta**: las sucursales depositan a una cuenta común, la administradora compra para CEDIS, y a veces una tienda deposita de más para ayudar a otra (deposita $60,000 y le tocan $50,000 de mercancía). Ese dinero no sale de la empresa, se mueve dentro. Registrarlo como gasto inflaría los totales de una sucursal y chocaría con Recepción de Compras.
- **Infraestructura ya disponible que se reutiliza:** catálogo de proveedores con RFC, catálogo de sucursales, roles con permisos granulares, subida de archivos a Google Drive (`backend/drive.js`), patrón de bitácora (`garantia_movimientos`), y el patrón de reportes (`backend/reportes.js` + `src/reportes/`).

## Requisito previo bloqueante

**Google Drive debe estar reconectado y estable antes de que el módulo entre en operación.** El comprobante es obligatorio (decisión de Victor, ver abajo), así que Drive deja de ser un extra y se vuelve dependencia dura: si Drive no responde, no se puede registrar ningún gasto, la cajera saca el dinero de todos modos y el problema regresa.

El token de producción expiró el 2026-07-28. Además de reconectar la cuenta en Roles y Personal, hay que **publicar la app OAuth de Google Cloud Console a estado "Production"**; en modo "Testing" los refresh tokens caducan cada 7 días y esto volvería a pasar.

**Consecuencia asumida:** si Drive falla en el momento de capturar, el gasto no se registra. Es el precio del comprobante obligatorio y Victor lo aceptó explícitamente.

## Decisiones tomadas con Victor

| Tema | Decisión |
|---|---|
| Mercancía | **Fuera del módulo.** Sigue solo en Recepción de Compras. |
| Depósitos y préstamos entre sucursales | **Módulo aparte, el siguiente.** No es un gasto: el dinero se mueve dentro de la empresa. |
| Forma de pago dominante | Efectivo de la caja de la tienda ⇒ integración con Corte de Caja es obligatoria. |
| Catálogo de categorías | Corto y **editable**, sembrado con lo que de verdad ocurre. No las ~70 subcategorías del prompt original (menús muertos ⇒ captura lenta ⇒ datos sucios). |
| Comprobante | **Obligatorio siempre.** Victor eligió esto sobre "opcional pero marcado", con la advertencia de la dependencia de Drive ya hecha. |
| Flujo de autorización | **Fuera de esta fase** (Fase 3). |

## Fuera de alcance (fases posteriores, YAGNI aquí)

Flujo de autorización multinivel · presupuestos y alertas por sucursal · caja chica · servicios recurrentes con vencimientos · tesorería, bancos y conciliación bancaria · KPIs financieros (burn rate, EBITDA, liquidez, flujo de efectivo) · gráficas del dashboard · IA financiera (detección de fraude, simulación, proyección) · estado de cuenta entre sucursales · 2FA, cifrado y respaldos.

Campos de la lista original que **no** se capturan en esta fase, con su razón: departamento (no existe el catálogo), persona que autoriza (Fase 3), banco / cuenta / referencia bancaria (Fase 5), UUID SAT / método de pago SAT / moneda / IVA / retenciones / subtotal / impuestos (contabilidad, fase posterior). Hoy solo harían más lenta la captura sin dar información que se use.

## Modelo de datos

Colección nueva de primer nivel `DB.gastos`, con tres arreglos. Se agrega al seed de `backend/server.js` y de `backend/testHelpers.js`.

### `DB.gastos.categorias`

Dos niveles, siguiendo el patrón que ya usa `DB["catalogo-productos"].categorias` (`categoria_padre_id`):

```js
{
  id,
  nombre,                 // "Combustible"
  categoria_padre_id,     // null = es un grupo; con valor = es subcategoría
  activa,                 // boolean — desactivar en vez de borrar
}
```

Un gasto apunta **siempre a una subcategoría** (hoja). El grupo se deriva por `categoria_padre_id`, y el reporte puede agrupar por cualquiera de los dos niveles.

**Semilla inicial** (grupos con sus subcategorías):

- **Servicios:** Luz, Agua, Internet, Teléfono, Software y licencias
- **Rentas:** Renta de local, Renta de bodega
- **Operación:** Papelería, Limpieza, Combustible, Mensajería y paquetería, Mantenimiento y reparaciones, Viáticos, Alimentos, Uniformes, Herramientas
- **Nómina:** Sueldos, Comisiones, Bonos
- **Marketing:** Publicidad digital, Impresos y lonas, Perifoneo
- **Bancarios:** Comisiones bancarias, Intereses, Terminal / TPV
- **Otros:** Imprevistos, Multas

### `DB.gastos.gastos`

```js
{
  id,
  folio,                  // "GA-0001" — prefijo GA para no confundirse con G- de Garantías
  fecha,                  // "YYYY-MM-DD"
  fecha_hora,             // ISO completo — necesario para asignar el gasto a un turno
  sucursal_id,            // el dato de alcance; nunca cambia
  categoria_id,           // FK a la subcategoría (hoja)
  concepto,               // texto corto obligatorio: "Garrafón de agua"
  descripcion,            // texto libre opcional
  monto,                  // number > 0
  forma_pago,             // "EFECTIVO" | "TRANSFERENCIA" | "TARJETA"
  proveedor_id,           // opcional, FK al catálogo existente
  numero_factura,         // texto opcional
  // Comprobante en Drive — OBLIGATORIO, los tres siempre con valor:
  nombre_archivo,
  drive_file_id,
  drive_link,
  usuario,                // nombre de quien lo registró
  estatus,                // "activo" | "cancelado"
  motivo_cancelacion,     // null mientras esté activo
}
```

### `DB.gastos.gasto_movimientos`

Bitácora, mismo patrón que `garantia_movimientos`:

```js
{ id, gasto_id, fecha, usuario, tipo, descripcion }
```

`tipo` ∈ `"creacion"` | `"cancelacion"`.

## Backend

### Nuevo módulo `backend/gastos.js`

Funciones planas que reciben `DB` (patrón de `garantias.js` / `apartados.js`). Recibe `drive` como parámetro para poder probarse sin la API real (patrón de `garantiasGastos.js`).

- `crearGasto(DB, datos, sucursalId, usuario, drive)` → gasto creado.
  - Valida: `categoria_id` existe, es hoja (`categoria_padre_id != null`) y está activa; `concepto` no vacío; `monto` numérico > 0; `forma_pago` válida; **archivo presente** (MIME PDF/JPG/PNG, ≤10 MB).
  - Sube el comprobante a Drive (carpeta raíz nueva "Comprobantes de Gastos", subcarpeta por sucursal) y guarda `drive_file_id`/`drive_link`/`nombre_archivo`.
  - **Si la subida a Drive falla, el gasto NO se crea** — no puede quedar un gasto sin comprobante.
  - Empuja movimiento `"creacion"` a la bitácora.
- `cancelarGasto(DB, id, motivo, usuario, alcance)` → gasto cancelado.
  - Guard de alcance. `motivo` obligatorio y no vacío.
  - No borra el registro ni el archivo de Drive: cambia `estatus` a `"cancelado"`, guarda `motivo_cancelacion`, empuja movimiento `"cancelacion"`.
  - Un gasto ya cancelado no se puede volver a cancelar.
- `listarGastos(DB, filtros, alcance)` → lista enriquecida (nombre de categoría, del grupo, de sucursal, de proveedor) con guard de alcance.
- `gastosEfectivoDelTurno(DB, sucursal_id, desde)` → suma de `monto` de los gastos **activos**, en **EFECTIVO**, de esa sucursal, con `fecha_hora > desde`. Es el enganche con Corte de Caja.
- CRUD del catálogo: `crearCategoria`, `renombrarCategoria`, `desactivarCategoria`, `listarCategorias(DB, { soloActivas })`.
  - No se borran categorías: se desactivan, para no romper los gastos históricos que ya apuntan a ellas.
  - No se puede desactivar un grupo que tenga subcategorías activas.

### Guard de alcance desde el día uno

**Cada** función que lee o muta un gasto existente valida `dentroDeAlcance(gasto.sucursal_id, alcance)` **dentro del módulo**, no en la capa de rutas. Un encargado amarrado a Ocosingo no puede ver ni cancelar el gasto de otra tienda ni por folio. Es la lección de Apartados, donde el guard vivía en las rutas, se olvidó en dos de ellas y se tuvo que parchar en auditoría.

Al crear, la `sucursal_id` sale **del token del usuario**, nunca del cuerpo de la petición.

### Integración con Corte de Caja (`backend/cortes.js`)

`calcularCorteEnCurso(DB, sucursal_id)` gana un componente nuevo:

```js
const gastosEfectivo = gastosEfectivoDelTurno(DB, sucursal_id, desde);
calculado.EFECTIVO = redondear(calculado.EFECTIVO - gastosEfectivo);
```

y devuelve además `gastos_efectivo` y `gastos_incluidos` (cuántos), para que la pantalla los muestre desglosados.

Reglas:

- Solo gastos **activos** y solo en **EFECTIVO** restan. Una transferencia o un pago con tarjeta no tocan la caja de la tienda.
- El turno se define exactamente igual que para las ventas: desde el último corte de esa sucursal. Un gasto se asigna al turno por su `fecha_hora`.
- **Un corte ya guardado queda congelado.** Cancelar un gasto después solo afecta al turno en curso — mismo comportamiento que ya tienen las ventas canceladas, y evita reescribir la historia de cortes cerrados.
- `crearCorte` guarda `gastos_efectivo` dentro del corte, para que el histórico conserve por qué el calculado fue el que fue.

### Rutas Express (`backend/server.js`)

| Ruta | Permiso |
|---|---|
| `GET /api/gastos` | `ver_gastos` |
| `POST /api/gastos` | `registrar_gastos` |
| `PUT /api/gastos/:id/cancelar` | `cancelar_gastos` |
| `GET /api/gastos/:id/movimientos` | `ver_gastos` |
| `GET /api/gastos/categorias` | `ver_gastos` |
| `POST /api/gastos/categorias` | `administrar_categorias_gastos` |
| `PUT /api/gastos/categorias/:id` | `administrar_categorias_gastos` |
| `GET /api/reportes/gastos` | `ver_reportes` |

Ninguna ruta lee `sucursal_id` del query por su cuenta: el alcance lo resuelve `alcanceSucursal(req, permisos)`, que ya ignora el query para usuarios amarrados.

### Permisos

Módulo nuevo `gastos`, registrado en `backend/permisosCatalogo.js` (`MODULOS_SISTEMA` y `MODULOS_QUE_REQUIEREN_PERMISOS`) — el guardia de arranque `validarSistemaDePermisos` bloquea el backend si falta. Permisos propios: `ver_gastos`, `registrar_gastos`, `cancelar_gastos`, `administrar_categorias_gastos`.

El rol Administrador los recibe solo por `reconciliarRoles()` en cada arranque; los demás roles los habilita Victor a mano en Roles y Personal.

## Frontend

### Pantalla "Gastos" (`src/Gastos.jsx`)

Tile propio en el Dashboard, junto a Corte de Caja. La pantalla tiene dos pestañas: **Gastos** y **Categorías**.

En la pestaña **Gastos**: tabla del periodo con filtros (fecha, categoría, forma de pago, estatus), botón **"Registrar gasto"**, y por renglón: ver bitácora y cancelar (con modal de motivo obligatorio). Un gasto cancelado se muestra con el monto en gris y una etiqueta "Cancelado" junto al folio; nunca desaparece de la lista.

### Modal de captura

Campos: categoría, concepto, descripción, monto, forma de pago, proveedor (opcional), número de factura (opcional), y comprobante (`type="file"`, accept `.pdf,.jpg,.jpeg,.png`, leído a base64 con el helper que ya usa `AdminRoles.jsx`).

El botón de guardar queda deshabilitado mientras no haya archivo, con el texto explicando por qué. Sigue las reglas de modales del proyecto (`max-h-[92vh] flex flex-col overflow-hidden`, cuerpo con `flex-1 min-h-0 overflow-y-auto`, header y footer `shrink-0`) y el botón lleva `type="submit"` explícito.

### Botón "?" de ayuda de categorías

Junto al selector de categoría, un botón **"?"** abre un panel con **todas las categorías y las subcategorías que trae cada una**, para que quien captura entienda dónde va cada gasto sin adivinar.

- **Lee del catálogo en vivo**, no de un texto escrito a mano: cuando Victor agrega, renombra o desactiva una subcategoría, la ayuda se actualiza sola. Solo muestra las activas.
- **Al hacer clic en una subcategoría del panel, queda seleccionada** en el formulario y el panel se cierra. Además de explicar, acelera la captura.

### Pantalla de Corte de Caja

Gana el renglón **"Gastos del turno"** con su monto y el número de gastos, arriba de la diferencia, para que la cajera vea por qué el efectivo esperado bajó. Con permiso `ver_gastos`, el renglón se puede desplegar para ver el detalle.

### Catálogo de categorías

Segunda pestaña de la pantalla de Gastos, visible solo con el permiso `administrar_categorias_gastos`: agregar grupo, agregar subcategoría a un grupo, renombrar y desactivar. Muestra los grupos con sus subcategorías anidadas — la misma vista que consume el botón "?".

### Reporte de Gastos

Noveno reporte en `src/Reportes.jsx`, con el patrón de los otros ocho:

- Filtros: rango de fechas, sucursal, categoría, forma de pago, proveedor, y estatus (activos / cancelados / todos — por defecto **solo activos**).
- Pestañas: **General** (renglón por gasto con folio, fecha, sucursal, grupo, categoría, concepto, proveedor, forma de pago, comprobante con link a Drive, monto) · **Por Categoría** · **Por Sucursal** · **Por Forma de Pago**.
- Totales al pie: número de gastos, total, y total cancelado por separado (nunca sumado al total vigente — mismo criterio que ya usa el Reporte de Ventas con las ventas canceladas).
- Exportar a Excel con el helper `descargarCSV` ya endurecido (entrecomillado, BOM y neutralización de fórmulas).

## Seguridad

- Todas las rutas exigen login + su permiso propio.
- Guard de alcance por sucursal dentro del módulo, en cada función que toca un gasto existente; criterio 404 ("Gasto no encontrado") tanto si no existe como si está fuera de alcance, para no revelar que existe en otra tienda.
- `sucursal_id` al crear sale del token, no del body.
- MIME y tamaño del comprobante validados en el backend, no solo con el `accept` del frontend.
- Nada se borra: los gastos se cancelan con motivo y la bitácora conserva todo.

## Pruebas

Backend (`backend/gastos.test.js` y `backend/gastosCorteCaja.test.js`, `node --test`), con un `drive` de prueba inyectado:

- Crear: valida categoría inexistente / inactiva / que sea grupo y no hoja; concepto vacío; monto ≤ 0 o no numérico; forma de pago inválida; **sin archivo → rechaza**; MIME no permitido; archivo > 10 MB.
- **Si la subida a Drive falla, no queda ningún gasto a medias en `DB.gastos.gastos`.**
- La `sucursal_id` del gasto sale del token aunque el body mande otra.
- Cancelar: motivo obligatorio; no se puede cancelar dos veces; el registro sigue existiendo; queda en la bitácora; guard de alcance (un usuario de otra sucursal recibe "Gasto no encontrado").
- Listar respeta el alcance.
- Catálogo: no se puede desactivar un grupo con subcategorías activas; un gasto histórico que apunta a una categoría desactivada sigue mostrando su nombre.
- **Corte de caja:** un gasto en efectivo baja el efectivo esperado del turno; uno en transferencia o tarjeta **no**; un gasto cancelado **no**; un gasto de otra sucursal **no**; un gasto anterior al último corte **no** (pertenece a un turno ya cerrado); y un corte ya guardado no cambia si después se cancela un gasto.

Frontend: sin arnés automático (convención del repo). Verificación manual en navegador, incluyendo el botón "?" reflejando un cambio hecho en el catálogo.

## Riesgos conocidos

1. **Dependencia dura de Google Drive** (ver "Requisito previo"). Es la consecuencia aceptada del comprobante obligatorio.
2. **Fechas en UTC.** Todo el repo guarda fechas con `new Date().toISOString()` y Chiapas es UTC−6, así que un gasto capturado después de las 6:00 pm queda con la fecha del día siguiente. Este módulo hereda el problema; arreglarlo es un cambio transversal del proyecto, no de esta fase.
3. **Captura desde el mostrador.** El comprobante obligatorio implica que la cajera tenga la foto del ticket en la computadora donde captura. Si en la práctica resulta un freno, la salida natural es permitir registrar y adjuntar en un segundo momento — pero eso contradice la decisión tomada, así que se revisará solo con evidencia de uso real, no por anticipado.
