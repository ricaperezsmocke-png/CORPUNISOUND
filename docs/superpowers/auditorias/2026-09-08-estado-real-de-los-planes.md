# Estado real de los planes de CORPUNISOUND — 2026-09-08

Victor: **sí hay pendientes que pueden costar dinero**, aunque los cortes ya integran garantías y monedero.
Orden de atención por exposición y facilidad de causar daño; no son pérdidas ocurridas ni importes medidos en producción:
1. **Ventas permite cantidades negativas:** cerré una venta de −$23.50 y el inventario subió una pieza, en una prueba aislada.
2. **Apartados permite regalar mercancía o crear saldo sin evidencia de cobro:** aceptó un artículo de $25 en $1 y un anticipo electrónico de $500 que terminó en monedero.
3. **Corregir gastos puede afectar otra tienda:** el permiso existe, pero falta comprobar la sucursal; además puede cambiar datos aunque la operación termine en error.
4. **Tómbola y tablero siguen pendientes:** no hay saldo integrado por caja ni protección contra registrar dos veces el mismo pago entre sus distintas entradas.
5. **Estado de Cuenta inventa deuda con CEDIS por traslados entre tiendas:** un envío Ocosingo→Yajalón de $200 cargó $200 de deuda.
6. **Un gasto de garantía puede borrarse mientras se cierra el corte:** el corte conserva $300 de gasto y su registro desaparece.
7. **Movimientos de Caja contradice al corte:** sumó $23.50 donde entraron $13.50 y se aplicaron $10 de monedero; puede originar un reclamo injusto.
8. **Respaldos está construido, pero sus remates quedaron pendientes:** incluso hay un mensaje que toma la existencia de una copia previa como prueba de restauración exitosa.
**Balance: 28 HECHO, 7 A MEDIAS, 1 NO HECHO y 1 YA NO APLICA; 37/37 revisados.**

## Alcance y significado de los dictámenes

Base comprobada al comenzar: rama `master`, commit `d345bdf5512eb90f91c7ddc800abd1043c5186db`. Se auditó el árbol de trabajo actual, sin cambiar de rama. Los 37 archivos incluyen `2026-08-15-fixes-auditoria-respaldos.md`, que está sin seguimiento: sus pendientes existen aunque el plan no forme parte del commit. Había otros archivos sin seguimiento, incluido `backend/resetPasswordLocal.js`; no se tocaron.

**HECHO** significa que los entregables funcionales están construidos y conectados en el código; no equivale a “sin defectos”, “desplegado” o “probado en tienda”. Una prueba escrita es evidencia de cobertura prevista, no de una ejecución exitosa hoy. **A MEDIAS** identifica entregables ausentes o controles incompletos comprobados; también se usa cuando una puerta posterior rompe el objetivo general de un plan antiguo. Los huecos nuevos fuera del alcance específico de un plan HECHO se explican por separado, para no confundir construcción con ausencia de riesgos.

Dinero, inventario, alcance y respaldos recibieron revisión de funciones y rutas. En planes antiguos de interfaz/migración se hizo el contraste rápido pedido. No usé las casillas como medidor. Solo escribí este informe; no ejecuté la suite ni abrí la base real. Las reproducciones usaron `construirDBPrueba()` y objetos en memoria, sin servidor, SQLite, Drive ni servicios externos.

Los números de línea corresponden al árbol auditado. Las rutas sin prefijo en una evidencia agrupada pertenecen a `backend/` cuando los archivos vecinos así lo indican.

## Tabla de los 37 planes

| Plan | Dictamen | Evidencia | Qué falta |
| --- | --- | --- | --- |
| 2026-07-06-aislamiento-sucursales.md | A MEDIAS | `backend/auth.js:197` (`alcanceSucursal`), `:272` (`filtrarPorSucursal`); `backend/consultarModulo.js:151`; `src/SelectorSucursal.jsx`. | Aislamiento original construido; quedó abierta la corrección posterior de gastos por id entre sucursales (`server.js:1921`). Ver sección de alcance. |
| 2026-07-08-catalogo-busqueda.md | HECHO | `backend/productos.js`, `crearDepartamento` / `crearProveedor`; `src/InventarioProductos.jsx:376`; filtros y paginación `src/Traspasos.jsx:173`; filtros del POS. | Sin pendiente funcional identificado en revisión rápida. |
| 2026-07-08-inventario-traspasos.md | HECHO | `backend/traspasos.js`: `crearTraspaso`, `recibirTraspaso`, `listarTraspasos`; `backend/productos.js`, `crearProducto`; `src/Traspasos.jsx`. | Sin entregable funcional pendiente identificado en la revisión rápida; recepción exige sucursal destino. |
| 2026-07-09-login-geolocalizacion.md | HECHO | `backend/auth.js:311` (`validarUbicacionLogin`); `backend/server.js:1230`; GPS y selección en `src/Login.jsx:77`; ubicaciones e intentos en `src/AdminRoles.jsx`. | Configuración GPS real de las tiendas: no verificada. |
| 2026-07-10-cedis.md | HECHO | `backend/sucursales.js`, `reconciliarSucursalesCedis`; `backend/compras.js`, `crearRecepcion`; `backend/productos.js:466`; rutas `server.js:1061`; `src/RecepcionCompras.jsx`. | Recepción y costo/precios construidos. Catálogo vivo de sucursales no verificado. |
| 2026-07-10-compras-pantalla-articulo.md | HECHO | `src/ArticuloCompra.jsx:24`; `src/RecepcionCompras.jsx:729`; `backend/cfdi.js:16`, `backend/clavesSat.js:20`, `backend/compras.js`, validación UUID y costo; `server.js:1077`. | Carga real del catálogo SAT y documentos reales: no verificados. |
| 2026-07-12-migracion-datos-sicar.md | HECHO | `backend/migracion.js`: `parsearExcel`, `aplicarImportacion`, `exportarRespaldo`; rutas `server.js:1103`; `src/MigracionDatos.jsx:22`. | Proceso construido; no certifica que la migración comercial de SICAR se haya ejecutado completa. |
| 2026-07-14-predicciones-demanda.md | HECHO | `backend/server.js:869` exige `ver_predicciones`; `src/PrediccionesDemanda.jsx:142`, gráfica `:293`; integración en `src/InventarioProductos.jsx`. | Sin pendiente funcional identificado en revisión rápida. |
| 2026-07-15-historial-ventas-prediccion.md | HECHO | `backend/historialVentas.js:35`, `:117`, `:132`; `backend/predicciones.js:16` suma historial; importación `src/PrediccionesDemanda.jsx:169`. | Archivos reales importados y su integridad: no verificados. |
| 2026-07-16-fixes-auditoria.md | HECHO | `src/PuntoDeVenta.jsx`, `confirmarCobro`; `src/InventarioProductos.jsx:147`, `:815`; `src/MigracionDatos.jsx:92`; `src/CorteCaja.jsx:316`. | Los cuatro arreglos puntuales existen. El plan pedía que Propina avisara «próximamente», no construir propinas; guardar cotizaciones de verdad sigue siendo otro pendiente. |
| 2026-07-17-dashboard-personal.md | HECHO | `backend/usuarios.js`: actualización/eliminación con protección del propio usuario; rutas `server.js:1298`, `:1307`; pestaña/modal Personal en `src/AdminRoles.jsx`. | Sin pendiente funcional identificado en revisión rápida. |
| 2026-07-18-asistente-chat-ui.md | HECHO | `src/AsistenteIA.jsx:69`, avatar; burbujas azules y botón `:128`, sugerencias `:108`. | Sin pendiente funcional identificado en revisión rápida. |
| 2026-07-18-expedientes-personal-drive.md | HECHO | `backend/documentosPersonal.js:26`, `:56`, `:60`; carpetas `backend/drive.js:157`; rutas `server.js:1390`; Documentos en `src/AdminRoles.jsx`. | Construcción y conexión de pantalla verificadas; configuración Google/Render y prueba real de la tarea 7 no verificadas. Ver callback adicional sin vínculo de sesión. |
| 2026-07-20-buscador-producto-compras.md | HECHO | `src/sugerirProducto.js:17`; `BuscadorProductoFila` en `src/RecepcionCompras.jsx:989`, usado en `:839` y `:913`; código extraído en `backend/facturaIA.js:32`. | Sin pendiente funcional identificado en revisión rápida. |
| 2026-07-20-escaneo-factura-ia.md | HECHO | `backend/facturaIA.js:52`, rechazo de documento ilegible `:78`; `backend/server.js:1085`; revisión de líneas en `src/RecepcionCompras.jsx`. | Servicio IA y lectura de factura real no verificados. |
| 2026-07-20-reportes-sistema.md | HECHO | Los siete reportes en `backend/reportes.js`; rutas `server.js:2521`; pantallas registradas en `src/Reportes.jsx:15`. | Los siete entregables originales existen; Movimientos de Caja quedó desactualizado tras monedero/garantías. Ver hallazgo adicional. |
| 2026-07-21-apartados.md | A MEDIAS | `backend/apartados.js:56` (`crearApartado`), `:178` (`registrarAbono`), `:223` (`cancelarApartado`); rutas `backend/server.js:1689`. Reproducción en memoria: cliente inexistente aceptado; anticipo MERCADOLIBRE de $500 convertido a monedero. | El ciclo existe, pero falta exigir cliente real y validar precios/formas de pago en el servidor. Ver hallazgo detallado. |
| 2026-07-22-garantias.md | HECHO | `backend/garantias.js:132`, `:171`, `:201`, `:215`, `:237`, `:267`, `:277`; rutas `server.js:1723`; `src/Garantias.jsx`. | Ciclo y bitácora construidos. Expediente ampliado no pertenece a este plan; ver pendientes sin plan. Stock de cliente se separó del propio (`esStockPropio`). |
| 2026-07-28-gastos-garantia.md | HECHO | `backend/garantiasGastos.js`: `agregarGasto`, `listarGastos`, `eliminarGasto`, `totalGastos`; `backend/garantias.js:302`; modal `src/Garantias.jsx`. | Gastos y comprobantes construidos; campo antiguo de costo salió de resolución. Ver limitación de concurrencia en hallazgos adicionales. |
| 2026-07-29-reporte-gastos-garantias.md | HECHO | `backend/reportes.js:421` (`reporteGastosGarantias`), cruce con garantía y sucursal, fecha local; ruta `server.js:2569`; `src/reportes/ReporteGastosGarantias.jsx`. | Sin pendiente de construcción identificado; prueba en tienda no verificada. |
| 2026-07-31-modulo-gastos.md | HECHO | `backend/gastos.js`: `crearGasto`, `cancelarGasto`, `gastosEfectivoDelTurnoLista`; `gastosCategorias.js`; `backend/cortes.js:200`; `backend/reportes.js:546`; `src/Gastos.jsx`. | Catálogo, captura con comprobante, cancelación, corte y reporte existen. Defectos de corrección añadida después se atribuyen al plan de caja fuerte. |
| 2026-08-01-fecha-local-y-compresion.md | HECHO | `backend/fechas.js:38`, `src/fechas.js:26`; reportes `backend/reportes.js:166`, `:430`; `src/comprimirImagen.js:28`, utilizado por `src/Gastos.jsx:208`. | No migra fechas históricas, por decisión documentada. |
| 2026-08-05-estado-cuenta-sucursales.md | A MEDIAS | `backend/depositos.js`, `crearDeposito`; `backend/traspasos.js`, costo congelado; `backend/estadoCuenta.js`, selección `recibidos`; `src/EstadoCuenta.jsx`. | La fórmula cobra todos los traspasos recibidos, sin exigir origen CEDIS. Reproducción: envío 1→2 por $200 genera deuda de $200 con cuenta común. |
| 2026-08-11-respaldos-y-restauracion.md | HECHO | `backend/respaldoCifrado.js:52`; `respaldoReloj.js:47`; `respaldos.js`: crear, retener, verificar, restaurar; reloj `server.js:423`; `src/Respaldos.jsx`; `scripts/respaldo-local.mjs`. | Sistema construido. Drive, recuperación real y tarea programada de la PC no verificados. Pendientes de robustez en el plan del 15 de agosto. |
| 2026-08-13-gerente-ventas-ia.md | A MEDIAS | `backend/gerenteVentas.js:101`, `:230`, `:321`, `:602`; `src/GerenciaVentas.jsx`; `backend/gerenteVentasIA.js:163` solo explica sugerencias de meta. | Faltan chat de ajustes y redacción de tareas del plan (tareas 4–6). El commit `23a264f` los dejó expresamente como fase posterior; sugerir metas no sustituye ese chat. |
| 2026-08-15-fixes-auditoria-respaldos.md | A MEDIAS | `render.yaml:24`, `:55`; `src/Respaldos.jsx:74`, `:159`; script local con validaciones; `backend/respaldos.js:201`; `backend/respaldoReloj.js:47`. | Faltan freno a fallos repetidos, alerta del backend ligada a configuración, helper de tipos, rotación del log y pruebas previstas. Sigue mensaje que confunde respaldo previo con restauración exitosa. Ver desglose. |
| 2026-08-22-radar-nucleo.md | HECHO | `backend/radar/entrada.js`, `metricas.js`, `reglasEstado.js`, `modelo.js`, `consultas.js`; fachada `backend/radarDemanda.js:13`; vínculo CRM implementado directamente en `backend/crm.js:95`, `:209` y `backend/radarDemanda.js:207`. | Cinco tareas construidas; agrupación difusa posterior tiene spec separado. |
| 2026-08-25-arreglos-auditoria-estilo.md | A MEDIAS | Arreglos en `src/AsistenteIA.jsx:123`, `src/InventarioProductos.jsx:538`, MXN en `src/RecepcionCompras.jsx:547`; pendientes `src/CorteCaja.jsx:444`, `src/RecepcionCompras.jsx:546`, `src/CRM.jsx:341`. | Total contado y Neto aún parecen editables; CRM conserva encabezado propio/Inicio; Login y barrido total no acreditados como terminados. Ver sección. |
| 2026-08-25-menu-categorias-neumorfismo.md | HECHO | `src/menuCategorias.js`, `categoriasVisibles`; `src/BarraLateral.jsx:90`; `src/App.jsx:19`; tokens y clases `src/index.css:37`, `:135`. | Estructura/estilo construidos. Remates visuales pendientes tienen plan propio, fila anterior. |
| 2026-09-01-cajas-punto-de-venta.md | HECHO | `backend/cajas.js`: `sembrarCajas`, `resolverCajaDeSucursal`, `esDeEstaCaja`; `backend/cortes.js:162`, `:237`; `backend/ventas.js:414`; `src/SelectorCaja.jsx`, `src/api.js:45`. | Dos cajas, absorción histórica, corte y corrección de venta construidos; ver defectos adicionales de dinero que no son estas tres fases. |
| 2026-09-03-tablero-dinero.md | YA NO APLICA | Sustituido por `2026-09-07-tablero-dinero.md` y su modelo de salidas de tómbola. | Evaluar la implementación en la fila del plan nuevo. |
| 2026-09-04-antifraude-punto-de-venta.md | HECHO | `ventas.js:31`, `clientes.js:94`, `reportes.js:254`, `apartados.js:240`, `productos.js:242`, `:432`, `mercadolibre.js:253`, `compras.js:76`; rutas cerradas `server.js:1265`, `:1273`; garantías en `cortes.js:166`. | 12 tareas construidas; confirmo el cierre de rutas. No significa ausencia de otros fraudes: cantidades negativas y entrada de Apartados quedan descritas aparte. |
| 2026-09-04-arreglos-revision-cajas.md | HECHO | `cajas.js`, `repararCajas` / `esDeEstaCaja`; `apartados.js:120`; `ventas.js:427`; `server.js:1909`; `src/Gastos.jsx`; `cortes.js:123`; `src/CorteCaja.jsx:373`; `src/reportes/ReporteCortesCaja.jsx:96`. | Diez entregables localizados, incluida prueba con permisos vecinos (`backend/cambiarCajaVenta.test.js:197`). |
| 2026-09-04-salidas-caja-fuerte.md | A MEDIAS | `backend/gastos.js`: origen, exclusión del corte y `corregirOrigenGasto`; `server.js:1890`, `:1921`; `src/Gastos.jsx:467`. | Sí fue implementado parcialmente en master: faltan filtro por Origen y acción de corregir en pantalla; corrección API sin alcance y protección histórica incompleta. Nuevo plan de tómbola absorberá el modelo, pero aún no existe. |
| 2026-09-05-dinero-de-garantias.md | HECHO | `backend/garantiasGastos.js:22`, `:34`, `:86`; `backend/cortes.js:84`, `:166`, `:223`, `:296`; `src/Garantias.jsx:51`, `:77`, `:340`. | Cuatro tareas construidas. Confirmo que el dinero entra al corte; eliminación concurrente del gasto tiene un defecto adicional, descrito aparte. |
| 2026-09-07-monedero-como-pago.md | HECHO | `backend/ventas.js:217`, `:370`; `backend/cortes.js:178`; `src/PuntoDeVenta.jsx:349`, `:526`, `:1254`; reproducción aislada: venta $23.50, monedero $10, corte $13.50. | Aplicación, límites, devolución y pantalla construidos. Falta actualizar otro reporte, fuera de los archivos/entregables de este plan. |
| 2026-09-07-tablero-dinero.md | NO HECHO | Ausentes `backend/tableroDinero.js`, `tombolaModelo.js`, `tombolaPersistencia.js`, `tombolaAcceso.js`, `erogaciones.js`, `salidasTombola.js`; sin pantallas `TableroDinero` / `SalidasTombola`; `backend/depositos.js` no guarda `caja_id`. | Las 12 tareas: modelo/migración, reserva y coincidencias, autorización por otra persona, adaptadores, cálculo, permisos, pantallas y recuperación. Gastos y depósitos existentes son dependencias, no este tablero. |
## Pendientes de dinero, inventario y permisos, plan por plan

### 2026-07-06 — Aislamiento de sucursales: A MEDIAS

**Construido:** el token lleva sucursal; `alcanceSucursal` decide filtros; clientes/CRM/predicciones y consultas del asistente filtran datos; las escrituras relevantes resuelven sucursal y la barra envía el filtro. Evidencias: `backend/auth.js:38`, `:197`, `:237`, `:272`; `backend/consultarModulo.js:151`; `src/SelectorSucursal.jsx`. Las operaciones por id de ventas y apartados sí comprueban alcance (`backend/server.js:1630`, `:1656`, `:1700`, `:1711`).

**Falta:** la puerta añadida después, `PUT /api/gastos/:id/origen`, solo comprueba login y `registrar_gasto_caja_fuerte` (`backend/server.js:1921`). Llama a `corregirOrigenGasto`, que busca el gasto por id sin comprobar su sucursal. Tener un filtro en la lista no protege esa modificación.

**Quién puede aprovecharse:** una persona con ese permiso, aunque esté amarrada a otra sucursal, que conozca el folio interno. **Qué obtiene:** capacidad de cambiar a quién se atribuye la salida; podría ayudar a ocultar un retiro o provocar una diferencia en otra tienda. **A quién le aparece:** a quien corte el cajón afectado. Si un gasto que realmente salió del cajón se reclasifica como caja fuerte, el corte deja de descontarlo y exige efectivo que ya se pagó. Reproduje que un usuario de sucursal 1 cambia un gasto de sucursal 2. Es el mismo defecto del plan de caja fuerte explicado abajo, no dos pérdidas distintas.

### 2026-07-21 — Apartados: A MEDIAS

**Construido:** crear, cobrar abonos, liquidar automáticamente, cancelar, reintegrar inventario, acreditar monedero y vencer a 60 días; corte por abonos y reportes/aviso CRM. Evidencias: `backend/apartados.js:56`, `:178`, `:214`, `:223`, `:265`; `backend/cortes.js:183`; `backend/reportes.js:35`; `src/ModalApartados.jsx`; `src/CRM.jsx:259`; pestaña Abonos y fecha de liquidación en `src/reportes/ReporteVentas.jsx`.

**Falta, comprobado:**

- El plan exige cliente real, pero `crearApartado` solo comprueba que el id convertido a número no sea cero; no busca al cliente (`apartados.js:57`). Aceptó `999999`, inexistente. Cancelarlo después no acreditaría nada a un cliente, porque no lo encuentra (`:258`).
- Los precios y descuentos salen del cuerpo recibido (`:99`), sin el recálculo ni permisos de descuento que ya existen en ventas normales. `server.js:1697` pasa ese cuerpo directamente. Un artículo de catálogo de $25 quedó liquidado en $1. No es el descuento autorizado de Victor: aquí no se exige ese permiso.
- Anticipo y abono solo prohíben “crédito”; no validan una lista de formas admitidas (`:65`, `:185`). Aceptó `MERCADOLIBRE` sin orden importada: anticipo $500, efectivo esperado $0, transferencias $500; al cancelar, monedero $500. El circuito de monedero construido después vuelve gastable ese saldo.
- Crear apartados sigue tragándose errores de inventario (`:151`–`:154`). Con la opción de permitir venta sin existencia puede haber una reserva sin descuento registrado. No reproduje este último escenario en la base real.

**Quién puede aprovecharse:** alguien con `gestionar_apartados`, mediante una petición directa, aunque la pantalla no ofrezca esas opciones. **Qué obtiene:** mercancía registrada por debajo de su precio o saldo a favor sustentado únicamente en una captura de pago. **A quién le aparece el faltante:** la venta barata puede cuadrar en caja y la pérdida queda para el negocio; el pago declarado como electrónico queda pendiente de contrastar con el banco, no como efectivo faltante. Un cliente inexistente también puede dejar a una persona honesta sin el reintegro que esperaba. No comprobé que nadie haya realizado estas operaciones en producción.

El vencimiento se procesa al consultar apartados o avisos de CRM (`:277`, `:298`), no con un reloj independiente. Esa es la implementación prevista originalmente; no lo clasifico como tarea ausente.

### 2026-08-05 — Estado de Cuenta de Sucursales: A MEDIAS

**Construido:** depósito con folio y bitácora, comprobante opcional, cancelación sin borrar evidencia, costo congelado al enviar mercancía, resumen y movimientos por tienda, permisos y pantalla. Evidencias: `backend/depositos.js`; `backend/traspasos.js`, `crearTraspaso`; rutas `backend/server.js:1973`; `src/EstadoCuenta.jsx`.

**Falta:** aplicar el origen CEDIS a la mercancía que genera deuda. `backend/estadoCuenta.js` arma `recibidos` filtrando estado, destino autorizado y fecha, pero no `sucursal_origen_id === 6`. Tampoco descarga de la deuda de la tienda que reenvía la pieza. La prosa y el objetivo del plan dicen “recibida del CEDIS”; su código propuesto también omitía esta condición: es un defecto de la solución diseñada, no solo una casilla olvidada.

**Prueba aislada:** un traspaso recibido 1→2, dos unidades a costo $100, produjo en Yajalón `recibido: 200`, `saldo: -200` sin participación del CEDIS. Si esa misma mercancía ya se cargó a Ocosingo cuando llegó del CEDIS, las dos tiendas quedan cargadas por el mismo recorrido.

**Quién puede aprovecharse:** no hace falta mala fe; basta un traslado normal entre tiendas. **Qué se pierde:** la fiabilidad del saldo que sirve para reclamar depósitos; no se movió dinero bancario en la prueba. **A quién se carga:** a la sucursal receptora, y al responsable al que se le reclame esa deuda. No es una diferencia del corte de una cajera.

### 2026-08-13 — Gerente de Ventas IA: A MEDIAS

**Construido:** meta, avance, generación de tareas, marcar hechas/descartadas, vista de vendedor y jefatura. `backend/gerenteVentas.js`, `tablero` y `sincronizarTareas`; rutas `server.js:2094` en adelante; `src/GerenciaVentas.jsx`. La sugerencia de meta con explicación de IA existe en `backend/gerenteVentasIA.js:163`.

**Falta:** redacción de las tareas con IA y chat para pedir reemplazos/ajustes, descritos en las tareas 4–6. No hay esa ruta ni esa pantalla. El commit `23a264f`, que sí forma parte del trabajo integrado, registra que se dejó “fase 2, si Victor la quiere”. Es una fase aplazada, no algo que deba implementarse ahora sin decisión.

**Quién puede aprovecharse / qué se lleva:** no encontré una fuga de dinero causada por la ausencia del chat. **A quién le aparece faltante:** a nadie por esta ausencia; el vendedor recibe menos asistencia que la anunciada en el plan. Las restricciones actuales de acceso a las tareas existen; no confundí el chat general del asistente con este chat.

### 2026-08-15 — Correcciones de Respaldos: A MEDIAS

El núcleo del plan del 11 de agosto sí existe: cifrado autenticado, compresión, reloj, creación, retención, verificación, clave/confirmación, exclusión de restauraciones simultáneas, modo mantenimiento, copia previa, reconciliación y cierre de sesiones. Las tareas del 15 de agosto no están todas terminadas:

- **Tarea 0:** `render.yaml:24` ya dice `starter` y declara disco en `:55`. No verifiqué que esos valores coincidan hoy con Render; no lo cambié.
- **Tarea 1:** las guardas principales que pedía corroborar sí están en `backend/respaldos.js:534`, `:538`, `:565`, `:589`; la ruta conserva permisos y alcance global. No reedité código ya corregido.
- **Tarea 2:** el límite que responde 429 existe en `backend/server.js:2212`; no encontré en `respaldosRutas.test.js` la prueba prevista de cinco claves incorrectas seguida del bloqueo de una correcta. No ejecuté la suite para afirmar su estado.
- **Tarea 3:** el refresco del token después de restaurar aparece como `tokenNuevo()` en `backend/respaldosRutas.test.js:423` y en la cobertura de concurrencia. No hace falta exigir el nombre literal `tokenFresco`.
- **Tarea 4:** botones con permiso propio y manejo de respuestas no JSON/red sí existen (`src/Respaldos.jsx:74`, `:127`, `:159`). Falta refresco periódico mientras otra sesión restaura: el estado carga al montar o tras una acción propia. Además `:164` afirma que ver `pre_restauracion` demuestra que la restauración ocurrió. Eso es falso: la copia se crea en `backend/respaldos.js:599`, antes de sustituir la base en `:625`, y todavía puede fallar.
- **Tarea 5:** script con rutas absolutas, mensajes y limpieza de `.parcial` construido. Faltan `scripts/respaldoLocal.test.mjs` y rotación del log: `scripts/respaldo-local.cmd:5` sigue acumulando con `>>`.
- **Tarea 6:** prueba del arranque apagado corregida y varios `try/finally` presentes. No encontré la prueba del borde 120/121 minutos en `backend/respaldos.test.js`.
- **Tarea 7:** `docs/RESPALDOS.md:290` ya usa `-StartWhenAvailable` y explica el error del comando viejo. No comprobé la tarea programada real ni doy por acreditada cada comprobación operativa del instructivo.
- **Tarea 8:** siguen ausentes el helper `esPuntoDeRestauracion`, el freno por fallos repetidos y la alerta del backend ligada a que exista llave. `estadoRespaldos(DB, ahoraMs)` aún calcula `alerta` solo por tiempo (`backend/respaldos.js:201`); el semáforo de la pantalla sí distingue configuración ausente. `backend/respaldoReloj.js:47` sigue decidiendo por hora/último éxito, sin el freno pedido.

**Quién puede aprovecharse:** no se necesita un atacante; una caída o restauración interrumpida basta. **Qué se arriesga:** que Victor crea haber recuperado datos cuando solo se hizo la copia previa, o que una automatización futura confíe en una alerta incompleta. **A quién se carga:** al negocio si se decide con registros equivocados; las ventas que falten pueden terminar reclamándose a quien cobró. No observé pérdida real ni comprobé una restauración fallida: la contradicción del mensaje se sostiene por el orden del código. La falta de rotación del log es menor y afecta la PC; no afirmo que esté llenando Render.

### 2026-08-25 — Arreglos de estilo: A MEDIAS

Hay arreglos reales: campo del asistente hundido (`src/AsistenteIA.jsx:123`), sugerencias con cambio de color, separación del panel de inventario (`src/InventarioProductos.jsx:538`) y etiqueta MXN sin relieve (`src/RecepcionCompras.jsx:547`).

**Falta comprobada:** “Total contado” sigue siendo un `div` con `neu-campo` (`src/CorteCaja.jsx:444`); “Neto” también conserva esa clase aunque el control esté deshabilitado (`src/RecepcionCompras.jsx:546`). El CRM conserva su encabezado y el botón Inicio (`src/CRM.jsx:327`–`:341`). No acredité como completados Login ni el barrido de contrastes/restos; decidir su diseño era parte del propio plan y no hay constancia suficiente aquí para declararlo sustituido.

**Quién puede aprovecharse:** no identifico un fraude por estos estilos. **Qué puede costar:** confusión al capturar/leer el corte. **A quién le aparece diferencia:** a quien captura el conteo, si se equivoca; no afirmo que el estilo haya causado un faltante ni que altere cálculos. Su prioridad económica es muy inferior a los huecos de servidor.

### 2026-09-04 — Salidas de Caja Fuerte: A MEDIAS

**Contradice la sospecha inicial de que solo era un spec viejo:** sí hay implementación integrada. Commits `2e8f1f1`, `fd8995d`, `fb675e9`, `6cb9162` y merge `b00160b` concuerdan con el código. El nuevo spec de tómbola lo absorberá, pero no ha sustituido su implementación.

**Construido:** `CAJON/CAJA_FUERTE`, gasto de caja fuerte excluido del efectivo esperado, permiso propio tanto para alta como corrección, casilla y aviso/columna. `backend/gastos.js`, `crearGasto` y `gastosEfectivoDelTurnoLista`; `backend/server.js:1890`; `src/Gastos.jsx:467`.

**Falta o quedó defectuoso:**

- Tarea 4, paso 3: filtro Todos/Cajón/Caja fuerte no existe; solo está la columna.
- La corrección existe en API, pero `src/Gastos.jsx` no tiene llamada a `/origen` ni acción para usarla. La verificación final del plan pedía poder corregir un gasto desde el flujo de trabajo.
- Corrección sin alcance de sucursal: `server.js:1921` y `corregirOrigenGasto`, ya explicado en Aislamiento.
- La protección de cortes solo mira `gasto.corte_id != null`. Un gasto histórico anterior al último corte y sin sello puede corregirse; reproduje esa aceptación. Falta aplicar la protección histórica, no reescribir cortes firmados.
- No valida todos los cambios antes de mutar: asigna `gasto.origen` y después valida `caja_id`. Reproduje una caja inexistente que lanza error, pero deja el origen cambiado y no agrega bitácora de esa modificación. Aunque la respuesta 400 no guarde inmediatamente, el objeto vivo quedó alterado y una operación posterior puede persistirlo.

**Quién puede aprovecharse:** un usuario con `registrar_gasto_caja_fuerte`; no cualquier visitante. **Qué obtiene:** cambiar la atribución del retiro, incluso en otra sucursal, o alterar un origen mediante una operación fallida sin su movimiento de bitácora. **A quién le aparece:** a quien corte el cajón afectado. Reclasificar como caja fuerte un pago que salió del cajón hace que el corte exija ese importe de más; la operación inversa puede encubrir una extracción equivalente del cajón. No hay aún saldo integrado de tómbola para contrastar ambos lados.

### 2026-09-07 — Tablero de Dinero: NO HECHO

No existen sus seis módulos nuevos de backend ni sus dos pantallas. Tampoco `deposito.caja_id` ni las colecciones y rutas de reservas/solicitudes. Revisé nombres de archivos, rutas y registros de gastos/depósitos, no solo la ausencia de `tableroDinero.js`.

**Faltan las 12 tareas:** modelo y migración única; persistencia/alcance; reservas y rechazo de coincidencias; gasto como fuente monetaria única; integración de depósitos; cancelaciones/correcciones; permisos/rutas; cálculo de cajones/tómbola/banco; lectura de evidencia; captura de salidas; pantalla del tablero; recuperación tras reinicios/restauraciones.

**Lo que sí hay y no debe reconstruirse:** cajas, cortes sellados, gastos con origen, depósitos, Estado de Cuenta y comprobantes de Drive. Son sus dependencias. El plan del 3 de septiembre queda YA NO APLICA por sustitución, no se cuenta como una segunda obra pendiente.

**Quién puede aprovecharse:** quien tenga acceso a registrar pagos/salidas y se aproveche de su falta de conciliación. **Qué puede llevarse:** efectivo del resguardo o registrar como pagado dos veces un mismo concepto. No hay la reserva, identificación de operación ni autorización por otra persona previstas en el plan nuevo. **A quién le aparece:** puede no aparecer en el corte de ninguna cajera, porque el gasto de caja fuerte ya se excluye del cajón; la pérdida queda en el dinero resguardado que Victor/contador deben reconstruir. No hay evidencia de que haya ocurrido ni un monto de exposición calculable con esta revisión.

## Comprobación de los planes importantes que sí están construidos

### Antifraude: las 12 tareas existen

Confirmo el dato del 7 de septiembre; no encontré una tarea de ese plan sin construir:

1. Crédito cerrado por lista permitida en `backend/ventas.js:74`–`:85`; la pantalla lo excluye.
2. Edición de clientes por lista blanca en `backend/clientes.js:94`, sin permitir saldo/monedero/límite de crédito por esa vía.
3. Precio de catálogo, descuento autorizado y permiso de artículo rápido en `backend/ventas.js:139`–`:181`; ruta pasa permisos en `server.js:1652`.
4. Autor/fecha de cancelación visibles en `src/ConsultasVentas.jsx:433` y reporte `backend/reportes.js:254`, con pantalla registrada en `src/Reportes.jsx:24`.
5. Cancelaciones/vencimientos de apartados con actor y fecha en `backend/apartados.js:240`, `:273`; las rutas pasan usuario.
6. Ajustes de inventario con usuario en `backend/productos.js:432`, mostrado en el historial del producto.
7. Alta con existencia genera movimiento por `ajustarExistencia` en `backend/productos.js:242`.
8. Errores de descuento/reintegro en ventas normales se registran en `backend/ventas.js:286`, `:386`, y cancelación de apartados en `apartados.js:252`. Es registro de error del servidor; no certifiqué alertas de producción ni un aviso visible a la cajera.
9. Orden ML exige `paid` (`backend/mercadolibre.js:253`, llamada en `:272`) y mueve inventario por la función común (`:391`).
10. Compras valida costo final positivo antes de mutar (`backend/compras.js:76`).
11. Roles y catálogo exigen login/administración (`backend/server.js:1265`, `:1273`); proveedores/categorías/departamentos y generar clave exigen sesión. `backend/rutasSinLogin.test.js` contiene la regresión añadida.
12. Dinero de garantía integrado al corte (`backend/cortes.js:166`, `:204`, `:296`).

**Límite decisivo:** completar estas 12 tareas no demuestra que todas las puertas de dinero estén protegidas. El plan no resolvió cantidades negativas de ventas ni el recálculo de precios y lista de pagos de `crearApartado`. Esos hallazgos se sostienen por el código actual y las reproducciones, no por reabrir una casilla terminada.

### Cajas, garantías, gastos y monedero

- **Cajas y revisión de cajas:** siembra, absorción histórica y comparación de ids de texto en `backend/cajas.js`; corrección de tickets cerrados con rastro en `backend/ventas.js:414`; caja en apartado `apartados.js:120`; gasto recibe caja del cuerpo `server.js:1909`; aviso histórico `cortes.js:123` y `src/CorteCaja.jsx:373`; reporte distingue caja `src/reportes/ReporteCortesCaja.jsx:96`; restauración repara y devuelve avisos en `backend/reconciliarRestauracion.js:37`. Las tres fases y diez correcciones están localizadas.
- **Garantías de julio:** máquina de estados, guard por sucursal, envío, regreso, entrega, días de atraso y bitácora existen. El inventario se mueve solo para stock propio (`backend/garantias.js:116`), una corrección respecto de la formulación original; el equipo del cliente no debe descontarse de la tienda. Expediente ampliado/envíos con bultos son otra obra, no un faltante del plan de julio.
- **Gastos y gastos de garantía:** categorías/subcategorías, folios, captura, Drive, bitácora, cancelación/eliminación prevista y reportes existen. Comprobante obligatorio en gasto general, opcional en garantía. No confundí los reportes independientes con “Utilidad”.
- **Dinero de garantías:** valida forma, sucursal y caja; cobra y gasta; el corte suma cobros y resta solo gastos en efectivo, excluye históricos sin los nuevos datos monetarios y sella los incluidos. `backend/garantiasGastos.js:22`; `backend/cortes.js:84`, `:166`, `:296`; formularios y saldo de caso en `src/Garantias.jsx:51`, `:77`. La decisión de NO restarlo de Utilidad está tomada: no es deuda pendiente.
- **Monedero:** se limita a cliente/saldo/total, se descuenta del cliente, se devuelve al cancelar una sola vez y el corte usa el resto cobrado. `backend/ventas.js:217`, `:352`; `backend/cortes.js:178`. Prueba aislada positiva: total $23.50, monedero $10, efectivo esperado $13.50. No repetí la prueba en navegador que Victor ya reportó.

## 1. Qué quedó a medias sin un plan que lo cierre

Estos son huecos concretos sin una tarea de cierre localizada en los 37 planes, o efectos posteriores que esos planes no contemplaron. Los dos problemas de Apartados y corrección de gastos ya están atribuidos arriba; no los cuento dos veces.

### Ventas normales admite cantidades negativas — riesgo alto

`backend/ventas.js:142` convierte cantidad con `Number(...) || 0`, pero no exige cantidad positiva/finita. La validación de existencia anterior solo compara si lo pedido supera lo disponible (`:94`); un número negativo pasa. Después el inventario recibe el negativo de esa cantidad, por lo que aumenta.

**Reproducción con el módulo real:** artículo de catálogo $25, cantidad −1, descuento de forma de pago vigente en el fixture: venta cerrada por −$23.50 y existencia 120→121. La ruta de `server.js:1640` exige `cerrar_venta`, pero no agrega validación de cantidades. No requiere permiso de descuento en este caso.

Alguien con permiso de cerrar venta puede crear entradas negativas que bajan lo esperado en caja y sacar efectivo equivalente, mientras el sistema inventa stock. La diferencia se desplaza al inventario físico o a una conciliación posterior; la venta queda registrada, no es un borrado invisible. No estimé frecuencia ni pérdidas reales.

### Movimientos de Caja no siguió al monedero y las garantías — riesgo de culpar a una cajera

`backend/reportes.js:364`–`:408` suma `v.total`, sin restar `monedero_aplicado`; solo agrega abonos y lista retiros de cortes. No integra como entradas/salidas las nuevas cobranzas/gastos de garantía ni los gastos generales como tales.

**Reproducción:** misma venta de $23.50 con $10 de monedero: corte $13.50, reporte de entradas $23.50. No hay $10 desaparecidos: el reporte trata saldo a favor como cobro. Quien investigue usando ese reporte puede reclamar a la cajera dinero que no recibió. El reporte de Ventas/Utilidad sí puede conservar el valor completo de la venta; no propongo restarle monedero a la facturación. Falta definir y completar el alcance del reporte de movimientos.

### Eliminación de gasto de garantía durante un corte — evidencia monetaria perdida

`backend/garantiasGastos.js:123` comprueba `corte_id`, espera el borrado en Drive (`:124`) y elimina por índice (`:125`) sin revalidar. El corte puede cerrarse durante esa espera.

**Reproducción en memoria con Drive sustituido por una promesa controlada:** inicié eliminar un gasto de $300, cerré un corte que lo selló, liberé la espera. Resultado: corte 1 conserva $300 de gastos, objeto sellado con corte 1, lista de gastos vacía. No se borró ningún archivo real.

Puede ocurrir sin mala fe entre dos personas. Quien revise el corte tiene un importe cuyo registro detallado ya no existe; la bitácora de eliminación no restituye el comprobante borrado. Afecta la defensa de quien pagó o cortó. El plan monetario sí construyó el sellado; falta proteger esa espera contra cambios simultáneos.

### Registro de gasto mientras se sube el comprobante — contemplado en el tablero nuevo, todavía abierto

`backend/gastos.js`, `crearGasto`, espera Drive antes de agregar el gasto. `crearCorte` no conoce una operación pendiente. Si la cajera ya pagó y se cierra el corte mientras sube, el gasto aún no reduce ese corte y puede aparecer después en el siguiente turno. No lo reproduje por HTTP; el orden se ve en las funciones. **Sí tiene respaldo futuro:** el plan del 7 de septiembre/spec de tómbola prevé `GASTO_EN_REGISTRO`. Se incluye aquí para que no se confunda con un pendiente nuevo sin solución diseñada.

### Puertas de conexión y sesiones fuera del cierre antifraude

- `GET /api/drive/callback` (`backend/server.js:1375`) y `GET /api/ml/callback` (`:2448`) cambian la cuenta conectada recibiendo un `code`, sin comprobar un estado pendiente ligado al usuario que inició la conexión. Las URLs de autorización tampoco incluyen ese estado (`backend/drive.js:105`; `backend/mercadolibre.js:78`). El permiso sí está al pedir la URL, pero no queda vinculado al retorno. Falta cerrar ese vínculo; no afirmo que un código inventado sea aceptado ni reproduje un cambio de cuenta contra los proveedores.
- `GET /api/sucursales` debe servir al login y oculta GPS sin autorización, pero su rama privilegiada valida el JWT directamente (`server.js:1509`–`:1514`) y no pasa por la revisión de cuenta activa/epoch de `requiereLogin`. La falta de esa revisión es comprobable; no probé una sesión revocada por HTTP.
- Índice/descarga de respaldos **no son públicos por falta de `requiereLogin`**: usan `tokenDeDescargaValido` (`server.js:2314`, `:2331`). Salud, inicio de sesión y lista básica de sucursales tienen uso público previsto. No los reporto como fraudes nuevos.

### Pantallas que prometen más de lo que hacen

- **Cotizaciones:** `confirmarCobro` solo llama al servidor si `!esCotizacion` (`src/PuntoDeVenta.jsx:510`), pero después dice “Cotización guardada” y limpia el ticket (`:547`). No localicé una colección/ruta de cotizaciones que conserve esa cotización. El fix del 16 de julio eliminó el bloqueo de efectivo, tal como pedía, sin construir almacenamiento. Un vendedor puede creer que conserva una oferta que no podrá recuperar.
- **Propina, consulta de saldos, devolución a proveedor, pedidos y carga masiva:** son avisos “próximamente”, no operaciones construidas. Evidencias: `src/CorteCaja.jsx:316`; `src/ConsultasVentas.jsx:229`; `src/RecepcionCompras.jsx:428`, `:531`; `src/PuntoDeVenta.jsx:613`. Las dos opciones de compartir/exportar configuración de Roles también son avisos (`src/AdminRoles.jsx:587`).
- **Crédito/cuentas por cobrar:** siguen apagados deliberadamente; no hay que reencenderlos como si fuera una casilla olvidada. `backend/ventas.js:48`–`:85`. El módulo no genera la deuda por una venta.
- **Precio de lista del cliente:** se guarda en `backend/clientes.js`, pero el cálculo normal del POS usa `producto.precio_venta` (`backend/ventas.js:154`). No hay tarea de cierre localizada para aplicar esa lista al cobro.
- **Expediente ampliado de garantías:** `crearGarantia` (`backend/garantias.js:146`) no tiene tipo de equipo, serie, accesorios ni fotos; rechazada/nota de crédito cierra directamente (`:229`). Es la etapa posterior decidida en `CLAUDE.md`, no los comprobantes de gastos ya construidos. No localicé un plan ejecutable para el expediente ni para bultos/escaneo entre los 37.

El barrido textual de TODO/FIXME no sustituyó estas comprobaciones: muchas coincidencias eran la palabra española “todo”. No encontré y confirmé una función de dinero llamada con nombre inexistente; no hice análisis exhaustivo de todas las llamadas dinámicas/importaciones, por lo que no certifico que no las haya.

## 2. Qué está construido sin un plan que justifique su alcance

**“Sin plan localizado” no significa “no solicitado”.** Los pedidos verbales y sesiones anteriores no se pueden reconstruir solo con este repositorio. Identifiqué estos casos para que Victor reconozca qué pidió:

| Construcción presente en master | Evidencia de código | Situación documental |
| --- | --- | --- |
| Catálogo propio de vendedores: alta, edición y desactivación | `src/CatalogoVendedores.jsx`, `backend/vendedores.js`; rutas `server.js:2012`–`:2044` | El plan del gerente reutilizaba vendedores y ligaba cuentas; no pidió este CRUD completo. Commit `57462b3`. No encontré plan dedicado entre los 37. |
| Sugerencia de meta con cálculo y explicación de IA | `backend/gerenteVentas.js:453`, `backend/gerenteVentasIA.js:163`; `src/GerenciaVentas.jsx:150` | El plan del 13 de agosto pedía meta/tareas/chat, no este mecanismo de sugerir meta. Commit `3e247ac`; posteriores decisiones de Victor constan en `f711d09`. No es prueba de trabajo no autorizado. |
| Adjuntar después la ficha de un depósito y resumen de depósitos sin comprobante | `backend/depositos.js`, `adjuntarComprobante`; `backend/estadoCuenta.js`, `sin_comprobante` / `monto_sin_comprobante`; `src/EstadoCuenta.jsx:230` | Amplía el plan del 5 de agosto. Commit `b90915e`, integrado en `4360961`; el nuevo spec/plan de tómbola ya lo reconoce como existente. No encontré plan previo propio. |
| Agrupación difusa de productos de Radar | `backend/radar/identidad.js`, usado por `radarDemanda.js:16` y `radarDemandaInteligencia.js:10` | **Sí tiene spec:** `docs/superpowers/specs/2026-08-31-radar-agrupacion-difusa-design.md`, pero no plan en la carpeta auditada. Es trabajo con respaldo de diseño. |
| Radar original e Inteligencia de Compras | `src/radar-demanda/`, `backend/radarDemandaInteligencia.js`, `backend/radarDemandaReglas.js` | El plan del 22 de agosto reestructura el núcleo y reconoce módulos ya existentes; no es el plan de creación de esas pantallas. No localicé plan inicial entre los 37. |
| Integración completa de MercadoLibre | `backend/mercadolibre.js`, `src/MercadoLibre.jsx`, rutas `server.js:2440` en adelante | Los planes la mencionan/corrigen, pero no contienen el encargo inicial de publicaciones, conexión y órdenes. Función anterior a varias de estas mejoras. |
| POS base, CRM base y configuración de formas de pago | `src/PuntoDeVenta.jsx`, `src/CRM.jsx`, `backend/crm.js`, `backend/condicionesPago.js`, `src/Configuracion.jsx` | Los planes de julio ya parten de ellos como existentes. No encontré su plan de creación en este conjunto; no es correcto tratarlos por eso como añadidos recientes no pedidos. |

**Las ramas “no-solicitado” no prueban construcción en master.** Comprobé con `git merge-base --is-ancestor` que las puntas de `crm-fase-1-no-solicitado` y `gerente-ventas-ia-no-solicitado` no son ancestros de `master` (ambas devolvieron 1). El commit `84d0a51` del motor de campañas tampoco es ancestro. Esto no descarta copias/cherry-picks parciales; por eso la tabla se sostiene en archivos actuales, no en nombres de ramas. No conté esos trabajos de otras ramas como módulos entregados.

## Lo que no pude verificar

- **Producción y tienda:** versión realmente desplegada, uso diario, importaciones completas de SICAR, datos SAT, permisos asignados a personas reales, saldos bancarios, movimientos ocurridos, configuración GPS, Drive, MercadoLibre o llamadas a IA. Ningún hallazgo prueba robo ni identifica a una persona real.
- **Respaldos operativos:** última copia útil real, descifrado con la llave de Victor, restauración completa, descarga de la PC, programación de Windows, plan/disco actual de Render y resultado de todas las revisiones anteriores. El código no demuestra que esos servicios estén configurados o funcionando hoy.
- **Pruebas de navegador pendientes:** no repetí el monedero ya probado por Victor ni certifiqué Garantías, Gastos y sus comprobantes/reportes en navegador. HECHO conserva esta limitación.
- **Suite/lint:** no ejecutados. No cambié código. Los nombres de pruebas citados prueban que existe cobertura escrita, no una suite verde hoy.
- **Reproducciones:** nueve escenarios aislados con módulos reales y objetos/servicios en memoria; se ejecutaron sin archivos de prueba nuevos. El primer intento de Node falló por `EPERM` al resolver `C:/Users/Victor`; el diagnóstico pudo correr con `--preserve-symlinks --preserve-symlinks-main`. No se clasificó ese fallo del entorno como hallazgo del negocio.
- **Autorización histórica:** no puedo afirmar que los módulos sin plan fueran trabajo no solicitado. Faltan las conversaciones o la confirmación del dueño.
- **Exhaustividad de seguridad:** revisé puertas relevantes y recorridos monetarios; no hice pentest completo, revisión criptográfica formal ni análisis exhaustivo de cada llamada. La ausencia de otro hallazgo no certifica seguridad total.
- **Importes y prioridad:** las cantidades son del fixture de prueba, no de Unisound. No usé `backend/datos.sqlite` para estimar exposición. El orden inicial es una prioridad de atención razonada, no un cálculo de pérdidas.
- **Control del documento:** los 37 planes tienen dictamen; ninguno quedó “no auditado”. Solo este archivo se creó/modificó para la entrega. Sin commit, push, merge, rebase ni cambio de rama.

