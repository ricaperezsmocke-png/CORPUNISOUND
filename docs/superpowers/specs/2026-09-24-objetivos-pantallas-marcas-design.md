# Mi Objetivo de Venta — Entrega B: pantallas de marcas, productos y créditos — Diseño

**Fecha:** 2026-09-24 · **Aprobado en conversación por Victor:** sí ("sí, así está bien, escríbelo").
**Rama:** `feature/objetivos-marcas-creditos` (el servidor de esta entrega ya está: commits `bbe1dc5`…`246ffb0`).

## Contexto

El servidor de metas de marca (pesos), producto (piezas) y crédito (Coppel Pay / Atrato, número de
créditos) quedó terminado en 6 tasks, con sus reglas y candados. **No hay ninguna pantalla** que lo
use. El rediseño visual de "Mi Objetivo de Venta" se partió en tres entregas, en el orden que eligió
Victor: **B** (esta: pantallas de lo nuevo) → **A** (tablero de avance con gráficas) → **C** (reordenar
las pantallas existentes estilo SICAR).

**Quién la usa:** todo en **computadora** (decisión de Victor 2026-09-24). Se diseña para PC; basta
con que no se rompa en pantallas angostas, sin optimizar para celular.

**Qué no cambia:** ninguna regla ni ruta del servidor. Las pantallas actuales (captura de venta,
actividades, reparto, cierre de venta) no se reorganizan en esta entrega; eso es la C. Ninguna
dependencia nueva. Estilo con las clases existentes (`neu`, `neu-panel`, `neu-campo`, `neu-boton`).

## 1. Navegación: pestañas en "Mi Objetivo de Venta"

Hoy `src/GerenciaVentas.jsx` apila todas las secciones. Se agrega una **barra de pestañas** sencilla
(botones grandes con icono arriba, estilo del sistema) que decide qué sección se muestra. Las secciones
existentes pasan tal cual a su pestaña, sin cambiarles nada por dentro.

- **Persona ligada a un vendedor:** "Mi venta" (captura existente + bloques nuevos de §2) ·
  "Mis actividades" (existente) · "Mis créditos" (nuevo, §2).
- **Jefatura con alcance en la tienda** (`editar_objetivos_venta`): además "Venta de la tienda"
  (reparto existente) · "Actividades de la tienda" (existente) · "Marcas, productos y créditos"
  (nuevo, §3). Una jefatura que también está ligada a un vendedor ve ambas familias de pestañas.
- La pestaña elegida se recuerda al cambiar de mes o sucursal (estado de React; no hace falta más).
- El selector de mes/sucursal y el aviso de mes cerrado quedan arriba, fuera de las pestañas.

## 2. La vendedora

### 2.1 "¿De qué marcas fue?" y "Piezas por producto" (dentro de "Mi venta")

Debajo de la captura de venta existente, dos bloques nuevos por día (el mismo día que elige la
captura de venta):

- **Marcas (pesos).** Un renglón por cada marca en que la persona tiene **meta vigente** ese mes
  (sale de `objetivos.marcas[].lineas` de `GET /api/objetivos/:mes/:sucursalId`), con campo para los
  pesos. Botón **"+ otra marca"** que abre un selector con las demás marcas **activas** de
  `GET /api/objetivos/catalogo/marcas`. Letrero en vivo: "De tu venta de $X llevas $Y en marcas".
  No está obligada a repartir toda la venta.
- Si ese día **no hay venta capturada**, el bloque se muestra deshabilitado con el texto "Primero
  captura tu venta de ese día" (es la regla del servidor; la pantalla solo la anticipa).
- Si la suma pasaría la venta, la pantalla lo avisa antes de enviar; **el servidor es quien rechaza**
  (candado de la decisión 3). El mensaje del servidor se muestra tal cual.
- **Productos (piezas).** Igual, con `objetivos.productos` y `catalogo/productos`, solo enteros ≥ 0,
  sin candado contra la venta.
- Cada renglón ya capturado muestra su valor y un botón **Corregir** que abre el diálogo de corrección
  con **motivo obligatorio** (`POST /api/objetivos/captura/:id/corregir`), igual que la venta. Una marca
  o producto ya capturado **no** se vuelve a capturar (unicidad por día + referencia del servidor).
- Se envía un renglón por petición (`POST /api/objetivos/captura` con `tipo: "marca"` + `marca_id` o
  `tipo: "producto"` + `producto_meta_id`). **No** se ofrece un "Guardar todo" que aparente ser una
  sola operación: si un renglón falla, los demás ya guardados quedan y la pantalla dice cuál falló.
- Al corregir la **venta a la baja** por debajo de lo capturado en marcas, el servidor rechaza con su
  mensaje ("corrige primero las marcas"); la pantalla lo muestra dentro del diálogo.
- Los datos capturados salen de `GET .../capturas/:vendedorId` (`capturas` de marca y producto,
  `total_por_marca`, `total_por_producto`).

### 2.2 "Mis créditos" (pestaña nueva)

- Formulario: financiera (Coppel Pay / Atrato, de `GET /api/objetivos/financieras`), fecha (hoy por
  defecto), monto (> 0), **folio** (obligatorio) y nota opcional (≤ 300). `POST /api/objetivos/credito`.
- Si el folio ya existe, se muestra el mensaje del servidor tal cual (dice quién y qué día; de otra
  tienda no dice nombre). "CP-123", "CP 123" y "CP123" son el mismo folio (decisión de Victor
  2026-09-24).
- Debajo: lista de sus créditos del mes (`GET .../creditos/:vendedorId` → `registros`, `resumen`),
  con resumen "Coppel Pay: N · Atrato: M" y su meta si la tiene. Los anulados se ven **tachados** con
  motivo, quién y cuándo; no desaparecen.
- **Anular** abre un diálogo con motivo obligatorio (`POST /api/objetivos/credito/:id/anular`).
- Mes cerrado: todo en solo lectura (sin formulario ni botón de anular).

## 3. El gerente: "Marcas, productos y créditos"

- **Una sola tabla** con todas las metas de la tienda: columnas *Tipo · Elemento · Unidad · Meta de
  tienda · Asignado · Pendiente/exceso*. Filas: cada marca (pesos), cada producto (piezas), Coppel Pay
  y Atrato (créditos). Datos de `objetivos.marcas`, `objetivos.productos`, `objetivos.creditos`
  (`meta_tienda`, `asignado`, `sin_asignar`, `lineas`).
- El pendiente se dice con palabras: "Faltan N por repartir", "Reparto completo" o "Asignaste N de
  más" (nunca un "sin asignar" negativo).
- **"+ Agregar meta"**: elegir tipo y elemento **de la lista** (nunca texto libre) y la meta de tienda.
  `POST /api/objetivos` con el tipo y la referencia correspondientes.
- Al elegir una fila, abajo aparece su **reparto por persona**, con el mismo patrón que ya tiene el
  reparto de venta: sugerencia (`GET .../sugerencia?tipo=…&marca_id=…`), "Usar sugerencia",
  "Pendiente de guardar / Guardada", historial (`GET .../historial/:vendedorId?tipo=…`), y **motivo
  obligatorio** al cambiar una meta existente. Se guarda una meta por petición.
- **Créditos de la tienda**: lista de `GET .../creditos` (quién, financiera, folio, fecha, monto,
  vigente/anulado con motivo). Solo lectura para el gerente: cada crédito lo anula quien lo registró.

## 4. Listas de marcas y productos

- Panel **"Listas de marcas y productos"** dentro de la pestaña de §3, visible **solo** si la persona
  tiene `editar_objetivos_venta` **y** `ver_todas_las_sucursales` (la ruta devuelve 404 a los demás;
  la pantalla ni siquiera muestra los botones).
- Dar de alta (`POST /api/objetivos/catalogo/:lista`) y **desactivar** (`POST …/:id/desactivar`). Muestra
  activos e inactivos (`?inactivos=1`). **No existe botón de borrar.** Lo ya capturado conserva su
  nombre aunque se desactive.

## 5. El cierre (`src/CierreObjetivos.jsx`)

- Debajo de la rejilla existente de venta contra SICAR, por persona, tres grupos: **Marcas** (pesos),
  **Productos** (piezas), **Créditos** (por financiera). Cada renglón: elemento · meta · capturado (o
  registrados) · **real** (campo) · diferencia. Datos de `previo-cierre` (`lineas[].marcas`,
  `.productos`, `.creditos`).
- Se envían en `POST /api/objetivos/cierre` dentro de cada real: `{ vendedor_id, real_sicar, marcas:
  [{ marca_id, real }], productos: [{ producto_meta_id, real }], creditos: [{ financiera, real }] }`.
  El servidor rechaza si falta alguno; la pantalla marca en rojo los campos vacíos antes de enviar.
- **Cierre sellado:** muestra los tres grupos con real, diferencia y rectificaciones por elemento
  (`POST /api/objetivos/cierre/:id/rectificar` con `marca_id` / `producto_meta_id` / `financiera`, campo y motivo).
- **Arreglo 1 — centavos:** el cierre mostraba pesos enteros (`pesos` en `src/objetivos/datos.js` usa
  `maximumFractionDigits: 0`). Se agrega un formateador con centavos y **el cierre** (venta y marcas)
  lo usa. Las demás pantallas no cambian en esta entrega.
- **Arreglo 2 — confirmación antes de sellar:** "Revisar y cerrar" abre un resumen final (sucursal,
  mes, número de personas, cuántas con diferencia en venta/marcas/productos/créditos) con botones
  "Sellar el mes" y "Volver". No exige que las diferencias sean cero (eso sería regla nueva).

## Lo que no se puede esconder

- Motivos, rastro de correcciones y "capturado N días después" siguen visibles junto al registro.
- Créditos anulados se ven tachados con motivo; nunca desaparecen.
- Diferencias del cierre **por persona y por elemento**, con centavos en pesos.
- Mes cerrado: todo en solo lectura; rectificar es una operación aparte con motivo.
- Una vendedora nunca recibe ni ve metas, capturas o créditos de otra persona (lo garantiza el
  servidor; la pantalla no debe intentar pedirlos).

## Pruebas y verificación

- Lógica de pantalla nueva (sumas del letrero de marcas, textos de pendiente/exceso, armado del cuerpo
  del cierre, formateador con centavos) en funciones puras de `src/objetivos/` con sus pruebas, como
  `datos.test.js`.
- `vite build` sin errores y `eslint` sin errores nuevos. Suite del backend intacta.
- **Prueba en navegador obligatoria** (Claude, no quien implementa), con backend local y datos
  sembrados: vendedora captura marcas y productos, candado de marca, corrección con motivo, crédito
  con folio repetido y con guion, anular; gerente fija metas y reparte; gerente de una tienda no ve las
  listas; administradora cierra con los tres grupos, ve la confirmación y los centavos; mes cerrado en
  solo lectura; 0 errores de consola.
