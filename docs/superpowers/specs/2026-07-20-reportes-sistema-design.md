# Módulo de Reportes de Sistema — Design Spec

## Contexto

Victor compartió 14 capturas de pantalla del módulo **Reportes** de SICAR (`C:\Users\Victor\Desktop\CARTELES EN TIENDA UNISOUND\Reportes en sicar\1.jpeg` a `14.jpeg`) — quiere replicarlo y mejorarlo dentro de CORPUNISOUND. De esas 14 imágenes, las últimas 3 (12-14) son en realidad del módulo **Procesos** (Favoritos, Importar, Exportar), no de Reportes — no aplican aquí.

CORPUNISOUND hoy no tiene ningún módulo de reportes. Existe `ConsultasVentas.jsx`, pero es una pantalla operativa de consulta/cancelación de ventas individuales, no un reporte agregado con exportación — no se toca en este proyecto.

SICAR expone más de 20 reportes (imagen 1), varios de otros giros de negocio (Farmacias, Restaurant, Vacaciones) que no aplican a una tienda de instrumentos musicales, y otros que requieren datos que CORPUNISOUND no captura todavía (Devoluciones a Proveedor, Notas de Crédito como documento propio, libreta de Abonos a Clientes/Proveedores — `aplicar_abonos_clientes` existe como permiso en `permisosCatalogo.js` pero está marcado `implementado: false`). Victor confirmó explícitamente que quiere todos los reportes viables **excepto los que no tengamos desarrollados**.

## Objetivo

Construir un módulo nuevo **Reportes** con 7 reportes, cada uno reutilizando datos que ya existen en el sistema (sin tablas nuevas):

1. Ventas
2. Utilidad / Ganancia
3. Compras
4. Cortes de Caja
5. Existencias / Inventario
6. Estado de Cuenta de Clientes
7. Movimientos de Caja

Cada reporte permite exportar a Excel e imprimir/PDF.

## Fuera de alcance

- **Devoluciones a Proveedor** y **Notas de Crédito** como reporte — no existen como documentos en el sistema.
- **Créditos Clientes/Proveedores por Periodo** y **Reporte de Abonos** — no hay libreta de abonos implementada (`aplicar_abonos_clientes: implementado: false`).
- **Corte de Caja Monedas / Extendido** (desglose billete por billete) — el Corte de Caja actual no captura denominaciones; requeriría rediseñar `CorteCaja.jsx`, es un proyecto aparte.
- Sub-reportes de SICAR que no aportan algo distinto para esta operación hoy: Paquetes, Usuarios, Descuentos %, Promociones (dentro de Ventas); Ingresos (dentro de Utilidad); Clave SAT dedicada, Catálogo de Artículos, Resurtir/Historial (dentro de Existencias — redundantes con pantallas ya existentes o con Predicciones de Demanda).
- Reportes de otros giros de negocio: Cotización, Farmacias, Monedero, Contador, Restaurant, Vacaciones.
- Envío por eMail de reportes (SICAR lo tiene; no se pidió y no hay infraestructura de correo saliente en el proyecto hoy).
- Generación de PDF con diseño propio (librería tipo `jspdf`) — se usa el diálogo de impresión del navegador en su lugar (ver Exportación).
- "Global / Resumen" (primer icono de la imagen 1, un dashboard consolidado) — no fue parte del alcance que Victor confirmó; puede agregarse después si lo pide.

## Diseño

### 1. Navegación y permisos

- Tile nuevo **"Reportes"** en `Dashboard.jsx`.
- Permiso nuevo `ver_reportes` (módulo `reportes`), registrado en `PERMISOS` y `MODULOS_SISTEMA` de `backend/permisosCatalogo.js`, y agregado a `MODULOS_QUE_REQUIEREN_PERMISOS` en `backend/validarPermisos.js` (guardia de arranque existente — bloquea el backend si un módulo nuevo no se registra ahí).
- `src/Reportes.jsx`: pantalla de aterrizaje con una cuadrícula de 7 iconos (mismo estilo visual que "Favoritos" de SICAR, imagen 1), uno por reporte. Un clic abre la pantalla de ese reporte.
- Cada reporte vive en su propio archivo dentro de `src/reportes/` (ej. `ReporteVentas.jsx`, `ReporteUtilidad.jsx`, `ReporteCompras.jsx`, `ReporteCortesCaja.jsx`, `ReporteExistencias.jsx`, `ReporteEstadoCuentaClientes.jsx`, `ReporteMovimientosCaja.jsx`).

### 2. Componentes compartidos

- `src/reportes/FiltroFechaSucursal.jsx`: rango de fechas (inicial/final) + selector de sucursal ("Todas" + lista), reutilizado por los reportes que filtran por fecha/sucursal (todos excepto Estado de Cuenta de Clientes, que filtra por cliente).
- `src/reportes/BarraAccionesReporte.jsx`: barra superior con botones **Consultar**, **Excel**, **Imprimir/PDF** — mismo patrón visual (`BotonBarra`) que ya usan `ConsultasVentas.jsx` y `RecepcionCompras.jsx`.
- Cada reporte compone estos dos + su tabla de resultados + fila de totales al pie (mismo patrón que el pie de `ConsultasVentas.jsx`).

### 3. Backend — `backend/reportes.js`

Un archivo nuevo con una función por reporte, todas de solo lectura sobre datos existentes:

| Función | Lee de | Notas |
|---|---|---|
| `reporteVentas(DB, filtros)` | `pos.ventas`, `pos.venta_detalle` | Agrupable por sucursal/vendedor/cliente/documento; sub-vista "por Artículo" cruza con `venta_detalle`; "Canceladas" filtra `estatus: "cancelada"` |
| `reporteUtilidad(DB, filtros)` | `pos.ventas`, `pos.venta_detalle`, `catalogo-productos.productos` | Utilidad = precio de venta − **costo actual** del producto (no hay costo histórico por venta — mismo comportamiento ya aceptado en Predicciones de Demanda). Sub-vistas por Artículo y por Departamento usan `producto.departamento_id`. |
| `reporteCompras(DB, filtros)` | `inventario.compras`, `inventario.compra_detalle` | Por proveedor o por artículo, incluye descuentos ya aplicados |
| `reporteCortesCaja(DB, filtros)` | `pos.cortes_caja` | Lista de cortes con calculado/contado/diferencia/retiro por caja/usuario/periodo |
| `reporteExistencias(DB, filtros)` | `inventario.existencias`, `catalogo-productos.productos` | Reutiliza los mismos 5 filtros de estado que ya tiene `listarProductos` (todos/con existencia/sin existencia/sobre máximo/bajo mínimo); agrega valor de inventario (Σ cantidad × costo, y Σ cantidad × precio de venta nivel 1) y "sin movimientos" (productos sin líneas en `venta_detalle` dentro del rango) |
| `reporteEstadoCuentaClientes(DB, filtros)` | `crm.clientes`, `pos.ventas` | Saldo/límite/disponible por cliente (campos ya existentes en `clientes.js`); detalle opcional de ventas a crédito del cliente (`metodo_pago: "CRÉDITO"`) |
| `reporteMovimientosCaja(DB, filtros)` | `pos.ventas`, `pos.cortes_caja` | "Entradas" = ventas cerradas agrupadas por forma de pago; "Salidas" = campo `retiro` de cada corte en el rango — no requiere tabla nueva |

Rutas nuevas en `server.js`: `GET /api/reportes/ventas`, `/utilidad`, `/compras`, `/cortes-caja`, `/existencias`, `/clientes`, `/movimientos-caja` — todas protegidas con el permiso `ver_reportes` (mismo patrón `requierePermiso` que ya usan las demás rutas del sistema).

### 4. Exportación

- **Excel**: botón genera y descarga un archivo delimitado por comas con encabezados y las filas visibles en pantalla (mismo mecanismo ya usado en `ConsultasVentas.exportarCSV` — abre directo en Excel, sin agregar dependencias nuevas al frontend).
- **PDF / Imprimir**: un botón "Imprimir" abre el diálogo de impresión del navegador (`window.print()`) sobre una vista con CSS de impresión (`@media print`) que oculta la barra de acciones y filtros, dejando solo título del reporte, criterios aplicados, tabla y totales. Desde ahí Victor elige "Guardar como PDF" o imprimir directo — cubre ambos casos sin agregar una librería de generación de PDF.

### 5. Testing

- `backend/reportes.test.js`: pruebas con `node:test` para cada función de agregación, siguiendo el patrón ya usado en `historialVentas.test.js`/`costoRecalculo.test.js` — casos con datos sembrados, filtros de fecha/sucursal, y el caso de utilidad usando costo actual.
- Frontend: sin arnés de pruebas automáticas (convención ya establecida en este proyecto) — verificación manual con datos reales en navegador (Chrome vía Playwright), cubriendo los 7 reportes y sus exportaciones.

## Limitaciones conocidas (confirmadas con Victor)

- **Utilidad** usa el costo *actual* del producto, no el costo histórico al momento de cada venta.
- **Cortes de Caja** no incluye desglose por denominación (billete/moneda) — el Corte de Caja actual no captura ese dato.
- **Estado de Cuenta de Clientes** no incluye historial de abonos — esa función no existe todavía en el sistema (`aplicar_abonos_clientes: implementado: false`).
