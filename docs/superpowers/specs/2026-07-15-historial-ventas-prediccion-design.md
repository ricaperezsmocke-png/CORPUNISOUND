# Historial de Ventas para Predicciones — Importar reporte de SICAR

**Fecha:** 2026-07-15
**Proyecto:** CORPUNISOUND (Unisound)
**Estado:** Diseño aprobado — listo para plan de implementación

## Objetivo

Victor tiene casi 8-10 años de historial de ventas real por sucursal en
SICAR (reporte "Reporte General de Ventas", exportable a CSV). Ese
historial puede alimentar el motor de predicción de demanda ya existente
(`backend/predicciones.js`, feature "Predicciones de Demanda" ya
desplegada) con muchos más meses de datos reales de los que CORPUNISOUND
lleva registrados por sí solo (el sistema es nuevo) — mejorando
significativamente la confianza de las predicciones.

Esto **no es** un catálogo que se mantiene sincronizado (como Artículos/
Clientes/Proveedores en Migración de Datos) — es una carga histórica
puntual (una vez por sucursal, o cuando Victor tenga un reporte más
reciente) que exclusivamente alimenta números a Predicciones. Por eso
vive dentro de la propia pantalla de Predicciones, no en Migración de
Datos.

## Decisiones de diseño (acordadas con Victor)

1. **Vive dentro de la pestaña Predicciones** (`src/PrediccionesDemanda.jsx`),
   como un botón/sección "Importar historial" — no una pestaña nueva, no
   dentro de Migración de Datos. Usa el mismo permiso `ver_predicciones`
   ya existente — no se crea un permiso nuevo.
2. **Formato: CSV.** SICAR también puede exportar en PDF/RTF/ODT/DOCX/HTML,
   pero CSV es texto plano estructurado — se procesa con un parser
   normal, sin necesidad de convertir el documento ni gastar tokens de
   IA en "leerlo". Un archivo por sucursal (cada sucursal tiene su propio
   SICAR independiente — mismo principio ya establecido en Migración de
   Datos).
3. **Se resume al importar, nunca se guardan tickets individuales.** El
   único dato que le importa a `predecirDemanda` es "cuánto se vendió de
   este producto en este mes" — así que el importador agrega
   inmediatamente por `(producto_id, sucursal_id, periodo)` y descarta el
   detalle de cada ticket. El resultado se guarda en una colección nueva,
   separada por completo de `DB.pos.ventas`/`DB.pos.venta_detalle` (que
   sí usan CRM para el historial/score de clientes y Corte de Caja) —
   **esta importación nunca toca esas colecciones ni nada que dependa de
   ellas.**
4. **Confirmación en bloque, no renglón por renglón.** A diferencia de
   Artículos/Clientes/Proveedores (donde cada renglón es una entidad de
   catálogo que se crea/actualiza individualmente), aquí hablamos de
   ~100,000 renglones de producto por sucursal — revisar uno por uno no
   es práctico ni tiene el mismo sentido (no se está creando ni
   modificando ningún producto, cliente o proveedor real, solo se suman
   números para un modelo estadístico). Se muestra un **resumen**
   (tickets leídos, rango de fechas, claves reconocidas vs. ignoradas,
   total de renglones agregados) y **un solo botón "Aplicar"**.
5. **Claves de producto que no coinciden con el catálogo actual se
   ignoran silenciosamente** (se cuentan, no se revisan una por una) —
   decisión explícita de Victor: son productos descontinuados o con
   clave distinta a como está hoy, no hay nada que predecir de ellos.
6. **`predicciones.js` SÍ se modifica** (a diferencia de la feature
   original de Predicciones, que explícitamente no lo tocaba) — para que
   `obtenerVentasMensuales` sume tanto el historial importado como las
   ventas reales que se sigan registrando en CORPUNISOUND. El modelo
   estadístico en sí (regresión + índice estacional) no cambia.

## Estructura real del archivo (confirmada contra un archivo real de Ocosingo)

El "Reporte General de Ventas" de SICAR en CSV **no es una tabla plana**
— es un reporte jerárquico exportado tal cual se vería impreso:

```
Reporte General de Ventas,,,,,,,,,,,Periodo:,,,01/01/2018 0:00,,,,,,-,,,15/07/2026 23:59,,,
Documento:,, Todos,,,,,,,,,,,,,,,,,Detalle:,,,,,,, Si
Cliente:,, Todos,,,,,,,,Estado:,, Vigente,,,,,,,Orden:,,,,,,, Fecha
Vendedor:,, Todos,,,,,,,,Usuario:,, Todos,,,,,,,Caja:,,,,, Todas,,
Documento,,,Fecha,,Folio,Cliente,,,Caja,,,,Usuario,,,,,Folio F.,,,Est,,,,Total   ,
Ticket,,,03/01/2018,,32228,PUBLICO EN GENERAL,,,Caja 1 FISC,,,,SEBAS,,,,,331,,,V,,,,$ 785.58,
PZA,2.0000,,,[2X18BICO] CABLE BICOLOR PARA BOCINA,,,,,,,,,,,$ 15.02,,,,,,,$ 30.04,,,,
PZA,1.0000,,,[TW6700D] TWEETER BALA PROF DIAMANTE TITANIUM 1500 ,,,,,,,,,,,$ 755.54,,,,,,,$ 755.54,,,,
Ticket,,,03/01/2018,,32230,PUBLICO EN GENERAL,,,Caja 1 FISC,,,,SEBAS,,,,,331,,,V,,,,$ 11.60,
PZA,1.0000,,,[AD136M] ADAP JACK 6.3mm ST A PLUG 3.5mm ST METAL,,,,,,,,,,,$ 11.60,,,,,,,$ 11.60,,,,
```

- Primeras 5 líneas: título del reporte, filtros aplicados (Periodo,
  Documento, Cliente, Estado, Vendedor, Usuario, Caja), encabezado de
  columnas — se descartan.
- Después, se repite: **un renglón de ticket** (columna 0 = `"Ticket"` o
  `"Nota de Venta"`; columna 3 = Fecha `DD/MM/AAAA`; columna 21 = Est,
  visto siempre `"V"` en este archivo — ya viene filtrado a solo
  vigentes por el propio filtro de exportación de SICAR, "Estado:
  Vigente") seguido de **uno o más renglones de producto** (columna 0 =
  unidad — vistas `PZA`, `METRO`, `MTR`, `m`, `PAQUE`, `JUEGO`, `NPR`,
  `JGOS`, `SET`, `PAR`, `jgo`; columna 1 = cantidad; columna 4 =
  `[CLAVE] DESCRIPCIÓN` en una sola celda entre corchetes).
- Archivo de Ocosingo: 184,722 líneas, 16.5 MB, 56,083 tickets, 99,508
  renglones de producto, del 03/01/2018 al 15/07/2026.

**Riesgo abierto:** los índices de columna de arriba están confirmados
contra ESTE archivo real. El parser debe detectar el renglón de producto
buscando el patrón `[algo] resto-de-texto` en las primeras columnas (no
asumir ciegamente la posición exacta), para tolerar variación menor
entre sucursales — pero si el reporte de otra sucursal viene
estructuralmente distinto, puede necesitar un ajuste cuando se pruebe
contra un archivo real de esa sucursal (mismo tipo de riesgo abierto ya
documentado para Migración de Datos).

## Arquitectura

### 1. Backend: `backend/historialVentas.js` (nuevo)

- `parsearReporteVentasSicar(csvTexto)` → recorre el CSV línea por línea
  manteniendo el "ticket actual" (fecha) mientras itera; por cada
  renglón de producto detectado, agrega a un mapa
  `{ clave, periodo: "AAAA-MM", cantidad }`. Devuelve
  `{ agregados: [...], resumen: { tickets_leidos, renglones_leidos, fecha_min, fecha_max } }`.
  Nunca guarda tickets/renglones individuales, solo el mapa agregado
  final.
- `previsualizarHistorialVentas(DB, agregados)` → cruza cada `clave`
  contra `DB["catalogo-productos"].productos` (mismo matching por
  `sku`/`clave_alterna` que ya usa `buscarArticuloExistente` en
  `migracion.js`). Devuelve
  `{ resumen: { tickets_leidos, renglones_leidos, fecha_min, fecha_max, claves_reconocidas, claves_ignoradas, total_renglones_agregados } }`
  — sin aplicar nada todavía.
- `aplicarHistorialVentas(DB, agregados, sucursal_id)` → para cada
  agregado con clave reconocida, suma la cantidad dentro de
  `DB.pos.historial_ventas_mensual` (colección nueva, formato
  `{ producto_id, sucursal_id, periodo, cantidad }`, un registro por
  combinación; si ya existe uno para esa combinación —por ejemplo al
  reimportar el mismo archivo— se **reemplaza**, no se suma encima, para
  que reimportar el mismo reporte no duplique cantidades). Nunca toca
  `DB.pos.ventas` ni `DB.pos.venta_detalle`.

### 2. Modificación a `backend/predicciones.js`

`obtenerVentasMensuales` se extiende para sumar también
`DB.pos.historial_ventas_mensual` (filtrado por `producto_id`/
`categoria_id`/`sucursal_id` igual que ya filtra `DB.pos.ventas`) al
mapa `porMes` que ya construye desde las ventas reales — incorporando el
histórico importado a la misma serie de tiempo que ya usa para tendencia
y estacionalidad. El resto del modelo (regresión lineal, índice
estacional, nivel de confianza) no cambia.

### 3. Rutas nuevas en `server.js`

- `POST /api/predicciones/historial/previsualizar` — recibe el CSV en
  base64 (mismo patrón que Migración de Datos), llama
  `parsearReporteVentasSicar` + `previsualizarHistorialVentas`, regresa
  el resumen. Gateada por `requiereLogin` + `requierePermiso("ver_predicciones", ...)`.
- `POST /api/predicciones/historial/aplicar` — recibe los `agregados` ya
  previsualizados + `sucursal_id`, llama `aplicarHistorialVentas`,
  regresa `{ producto_id_actualizados, renglones_aplicados }`. Mismo
  gate de permiso.
- El límite de `express.json` para estas rutas necesita subir más allá
  de los 15mb ya usados por Migración de Datos — el archivo real de
  Ocosingo (16.5 MB) en base64 pesa ~22 MB; otras sucursales con más
  años de historial podrían pesar más. Subir a 50mb para esta ruta (o
  el límite global si es más simple de mantener).

### 4. Frontend: sección nueva dentro de `src/PrediccionesDemanda.jsx`

- Botón "Importar historial" (visible junto al resto de la pantalla,
  mismo lenguaje visual). Al hacer clic: selector de sucursal (si
  `ver_todas_las_sucursales`) + input de archivo `.csv`.
- Al subir: `POST /api/predicciones/historial/previsualizar` → muestra
  el resumen (tickets leídos, rango de fechas, X claves reconocidas / Y
  ignoradas, Z renglones agregados en total) + botón único "Aplicar".
- Al aplicar: `POST /api/predicciones/historial/aplicar` → aviso de
  éxito con el resumen final, y sugerencia de recalcular una predicción
  para ver el efecto.

## Flujo de datos

1. Victor sube el CSV de una sucursal desde la pestaña Predicciones.
2. El backend parsea el archivo completo, agregando cantidades por
   producto y mes (sin guardar tickets individuales), y regresa un
   resumen — sin tocar la base de datos todavía.
3. Victor revisa el resumen y confirma con un solo botón.
4. El backend aplica los totales agregados a
   `DB.pos.historial_ventas_mensual`, reemplazando (no sumando) cualquier
   valor previo para la misma combinación producto+sucursal+mes.
5. Desde ese momento, cualquier predicción calculada para esos productos/
   categorías incluye automáticamente ese historial.

## Manejo de errores

- **Archivo no es un CSV válido o no tiene la estructura esperada**: el
  parser regresa un error claro ("no se pudo leer como reporte de
  ventas de SICAR"), sin tronar el servidor.
- **Cero tickets/renglones detectados**: se avisa explícitamente en vez
  de aplicar un resumen vacío silenciosamente.
- **Archivo muy grande** (más allá del límite de body): el backend
  responde con un error entendible, no un timeout silencioso — a
  verificar en la prueba manual con el archivo real de Ocosingo.
- **Reimportar el mismo archivo (o uno más reciente de la misma
  sucursal)**: reemplaza los valores por combinación producto+mes, no
  los duplica ni los suma encima.
- **Sin permiso `ver_predicciones`**: ni el botón de importar ni las
  rutas están disponibles (mismo patrón ya usado en toda la app).

## Pruebas

- **Backend:** `backend/historialVentas.test.js` — pruebas del parser
  contra fragmentos de CSV sintéticos (con la estructura real
  confirmada arriba: renglón de ticket + renglones de producto,
  múltiples unidades, claves que coinciden y que no coinciden con el
  catálogo, reimportación que reemplaza en vez de duplicar). **No** se
  usa el archivo real de Ocosingo dentro de las pruebas automatizadas
  (son datos reales del negocio, no deben quedar en el repositorio ni en
  el historial de git) — los tests usan datos sintéticos que replican la
  misma estructura.
- **Backend:** prueba de que `obtenerVentasMensuales` en
  `predicciones.js` efectivamemte suma `DB.pos.historial_ventas_mensual`
  junto con `DB.pos.ventas`/`venta_detalle` reales.
- **Frontend:** sin pruebas automáticas (patrón establecido). Verificación
  manual: build limpio, y una prueba en navegador real usando el propio
  archivo real de Ocosingo (u otra sucursal si ya está disponible para
  entonces) para confirmar que el volumen real (184,722 líneas) se
  procesa correctamente y en un tiempo razonable, antes de dar el
  trabajo por terminado.

## Riesgo abierto

- **Estructura del reporte confirmada solo contra Ocosingo.** Si el
  reporte de otra sucursal viene con columnas en posición distinta
  (ej. si algún filtro de SICAR queda configurado diferente al
  exportar), el parser puede necesitar un ajuste — recomendado probar
  con al menos una segunda sucursal antes de asumir que todas
  funcionarán igual.
- **Tiempo de procesamiento.** 184,722 líneas es un archivo grande;
  parsear + agregar corre de forma síncrona en el servidor durante la
  petición — para archivos aún más grandes (sucursales con más años de
  historial) podría tardar varios segundos, bloqueando el hilo único de
  Node durante ese tiempo. Aceptable para una carga puntual poco
  frecuente, pero vale que Victor lo sepa: mientras se procesa un
  historial grande, el resto del sistema podría sentirse lento para
  otros usuarios en ese momento exacto. No se construye ninguna cola de
  procesamiento en segundo plano para esto — sería sobre-ingeniería para
  una carga ocasional.
- **Alcance explícitamente limitado a alimentar Predicciones.** Victor
  mencionó interés en "patrones de venta y otras estadísticas" en
  general — este trabajo cubre específicamente el modelo de predicción
  ya existente (tendencia + estacionalidad). Cualquier reporte o
  gráfica adicional sobre este historial sería un proyecto aparte, a
  diseñar por separado si Victor lo pide.

## Self-Review (hecho al escribir este spec)

**Cobertura:** Objetivo → sección Objetivo. CSV, un archivo por
sucursal → Decisiones 2. Resumen + confirmación en bloque → Decisión 4,
sección Frontend. Claves no reconocidas se ignoran → Decisión 5. No
tocar `ventas`/`venta_detalle` → Decisión 3, confirmado en Arquitectura
punto 1. `predicciones.js` sí se modifica (con justificación explícita
de por qué esta vez sí) → Decisión 6, Arquitectura punto 2.

**Placeholders:** ninguno.

**Consistencia:** `DB.pos.historial_ventas_mensual` con la forma
`{ producto_id, sucursal_id, periodo, cantidad }` se usa igual en
`aplicarHistorialVentas` (Arquitectura 1) y en la extensión de
`obtenerVentasMensuales` (Arquitectura 2).
