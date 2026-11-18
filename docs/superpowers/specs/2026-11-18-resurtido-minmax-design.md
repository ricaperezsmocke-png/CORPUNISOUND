# Resurtido automático con mínimos y máximos (JR y Solcor) — diseño

Fecha: 2026-11-18. Autor: Claude, con las decisiones de Victor de la conversación del mismo día.
Rama de documentos: `docs/resurtido-minmax` (base `fbf7097`).

## 1. Para qué

Lo básico de la tienda (cuerdas, fundas, accesorios JR; cable por metro, cables armados y conectores Solcor) es el "pan
de cada día" y **se está quedando en cero**. Hoy el encargado de cada tienda revisa a ojo qué falta y lo pide; se le
pasan piezas y no considera temporadas. El resultado medido en San Cristóbal (sección 3) es doble pérdida: lo que más se
vende pasa meses en cero, y lo que no se vende se acumula durante años.

**Éxito para Victor:** que nunca falte lo básico y que no se acumule de más. El sistema calcula por tienda cuánto debe
haber, arma solo el pedido y una persona da el visto bueno; si algo se acaba antes del siguiente pedido, el sistema
propone pasarlo de otra tienda que tenga de sobra o pedir extra.

## 2. Decisiones de Victor (2026-11-18) — no volver a preguntarlas

1. Empezar **solo con JR y Solcor**, como prueba. Otras marcas después.
2. Mínimos y máximos **por tienda**, calculados de **todas sus ventas**, tomando en cuenta **temporadas** (altas y bajas
   en todo el historial de SICAR).
3. Buscar **equilibrio**: ni quedarse sin mercancía ni tener demasiado.
4. **Todo producto lleva mínimo** (ver 6.2 sobre los que no se venden).
5. Los mínimos y máximos **se pueden corregir a mano**.
6. El sistema **junta lo que hace falta y solicita solo** tantas piezas por tienda; **alguien da el visto bueno** antes.
7. Quien pide hoy es **el encargado de cada tienda**.
8. **CEDIS se queda vacío**: solo recibe y reparte a cada tienda lo que pidió. CEDIS no lleva mínimo ni máximo.
9. Se pide más o menos **mes con mes**; tarda **15 a 20 días** en llegar; **sin pedido mínimo** ni límite del proveedor.
10. Si algo se agota entre pedidos: tres salidas — **pedir de nuevo**, o que el sistema detecte **otra tienda con
    sobrante** y proponga **pasarle** a la que se quedó sin existencia.
11. Proveedores en SICAR: JR = "ACCESORIOS MUSICALES JR"; Solcor = "EXTENSIONES ELECTRICAS Y DE AUDIO, S.A. DE C.V.".

## 3. Lo que mostró la prueba de lectura en San Cristóbal (SICAR, 2026-11-18)

Lectura solo SELECT del SICAR de la tienda (ventas desde 2021-07, traspasos desde 2023). Script:
`scratchpad/analisis-sc.js` de la sesión de Claude (no está en el repo).

- **La marca vive en el departamento** del artículo (`departamento.nombre` = 'JR' / 'SOLCOR'): 200 y 260 artículos
  vigentes. El vínculo por proveedor (`proveedorarticulo`) es incompleto: JR 78 vigentes, Solcor 73. **CORPUNISOUND ya
  recibe `sicar_articulos.departamento`.**
- JR: ~95 piezas/mes, **sin temporada** (índices mensuales 0.9–1.1). Último resurtido 2026-07-10 (4 meses sin llegar).
- Solcor: **temporada real**: octubre 1.3, noviembre 1.2, junio 1.2; abril 0.8, mayo 0.6. Resurtido cada ~31 días en
  mediana pero con huecos de 2–3 meses.
- Agotados de los que más se venden (días en cero en el año, reconstrucción aproximada): cuerdas 1a bajo sexto 132,
  cuerdas 1a violín 160, juego nylon acústica 122, funda teclado 200; cable uso rudo 2x16 **311**, speakon panel 236,
  cables de micrófono 3/6/10 m más de 200.
- Sobrados: cuerdas nylon 2a 56 pz contra 15/año; jack canon 3 tornillos 196 pz contra 11/año; cable micrófono azul
  86 m contra 14/año.
- **106 JR y 175 Solcor vigentes no se vendieron en 12 meses** (algunos porque estaban en cero).
- El cable por metro (`unidadVenta` 18) llega en **rollos de 100 o 200 m**.
- SICAR ya tiene `articulo.invMin/invMax`, pero casi nadie los usa (32 de 6,454).

## 4. Los datos que ya existen en CORPUNISOUND (verificar contra el código antes de planear)

- `sicar_articulos (sucursal_id, art_id, clave, descripcion, categoria, departamento)` — marca = `departamento`.
- `sicar_detalles` (ventas con cliente, todo el historial) y `sicar_detalles_mostrador` (público en general, **solo
  desde 2025-01-01**: `INICIO_MOSTRADOR` fijo en `agente-sicar/mapeo.js`).
- `sicar_existencias` por tienda, cada 5 minutos.
- `sicar_traspasos` / `sicar_traspasos_detalle` y `sicar_sucursales_mapa` (número SICAR → tienda).
- `sicar_compras` / `sicar_compras_detalle` solo de CEDIS (6) e Innotec (7), con `pro_id` y `sicar_proveedores`.
- El `art_id` cambia de una tienda a otra: el mismo producto se reconoce entre tiendas por **`clave`** (así lo hace el
  Seguimiento de facturas).
- Radar de Compras ya tiene `calcularReposicion` (`backend/radarDemandaReglas.js`): piezas = mínimo − existencia −
  tránsito, con bloqueos con motivo y el importe a último costo. Reaprovechar la idea, no forzar el Radar (tope de 300
  productos y gira alrededor de la demanda capturada).
- Tiendas con agente: Ocosingo (1), Yajalón (2), San Cristóbal (3), Palenque (4). Innotec (7) **queda fuera** (otra
  razón social, no se surte de CEDIS). CEDIS (6) no lleva mín/máx.

## 5. Enfoques considerados

- **A (elegido): pedido mensual automático con visto bueno + avisos diarios**, construido por partes. Es lo que pidió
  Victor: el sistema solicita solo y una persona aprueba.
- B: solo mínimos/máximos y una lista de faltantes; el encargado sigue armando el pedido. Descartado: deja el error
  humano que se quiere quitar. Sirve como primera entrega de A.
- C: meterlo en el Radar de Compras. Descartado como casa del módulo (tope de 300, lógica de demanda capturada, no
  maneja traspasos entre tiendas); sí se reaprovecha su cálculo de faltante e importe.

## 6. El diseño

### 6.1 El cálculo del mínimo y el máximo (por tienda y por clave)

- Base: venta diaria por clave y tienda (con cliente + mostrador, solo ventas vigentes), **excluyendo los días en que la
  tienda estuvo en cero** para no aprender que "no se vende" lo que en realidad no había.
- Temporada: índice por mes del año **por marca** (con los años completos disponibles). Se aplica el índice del mes en
  curso y del siguiente (el que cubre el pedido).
- Mínimo = venta diaria ajustada × plazo de entrega (20 días) + colchón de seguridad por variación (nivel de servicio
  ~95 %). Máximo = mínimo + venta de un ciclo de pedido (30 días). Valores por omisión configurables por marca.
- Unidades: piezas enteras; **el cable por metro se calcula en metros**.
- Se recalcula solo (cada noche); el valor corregido a mano **gana** sobre el calculado hasta que alguien lo quite, y
  queda **quién, cuándo y por qué**.
- Historial: pedir al agente las ventas de mostrador **antes de 2025** (hoy `INICIO_MOSTRADOR` es fijo) para tener
  temporadas completas. Si eso se retrasa, se calcula con lo que haya y la pantalla dice cuántos meses de historia usó.

### 6.2 Productos que no se venden (decisión de Claude, Victor puede cambiarla)

- Llevan mínimo calculado los que se vendieron al menos una vez en 12 meses.
- Los que estuvieron **en cero** casi todo el año y por eso no vendieron van a una lista **"revisar: sin historia por
  falta de existencia"** con mínimo 1 propuesto.
- Los que **tuvieron existencia y no se vendieron** van a una lista **"no se mueve"** para que Victor decida si siguen
  en esa tienda; no generan pedido. Así se respeta "todo lleva mínimo" sin surtir 281 productos muertos por tienda.

### 6.3 El pedido mensual con visto bueno

1. En la fecha de corte (configurable, ~mensual) el sistema arma **un borrador por proveedor (JR, Solcor)** con, por
   tienda, lo que necesita para volver a su máximo: máximo − existencia − lo que ya viene en camino.
2. **El encargado de cada tienda** revisa su parte, la ajusta y da su visto bueno (permiso propio).
3. **Victor (o quien tenga el permiso)** aprueba el pedido completo.
4. Sale como **lista para mandar al proveedor** (imprimir / copiar a WhatsApp). **El sistema no envía nada al
   proveedor por su cuenta.**
5. Al llegar, la **hoja de reparto por tienda** ya está hecha.
6. **Cable por metro (decisión de Claude):** al proveedor se le pide en **rollos completos** (se redondea el total hacia
   arriba al tamaño del rollo); a cada tienda se le reparten metros. El sobrante del rollo se asigna a la tienda que más
   vende ese cable.
7. El pedido se da por **surtido** cuando aparecen la compra en el SICAR de CEDIS y los traspasos CEDIS → tienda; la
   diferencia entre lo pedido y lo que llegó queda a la vista.

### 6.4 Avisos entre pedidos

- Diario: una tienda que cae **abajo de su mínimo** antes del siguiente pedido genera un aviso con dos propuestas:
  - **Pasar de otra tienda**: si otra tienda tiene más que su máximo (o más que su mínimo + lo que le falta a la que
    está en cero), propone cuántas piezas pasar. El traspaso se hace en SICAR como hoy.
  - **Pedir extra** al proveedor (pedido corto con el mismo visto bueno).
- El encargado escoge; el aviso se cierra solo cuando la existencia vuelve a estar arriba del mínimo.

### 6.5 Lo que se guarda y quién puede qué

- Tablas nuevas en SQLite (mismo patrón que el seguimiento): parámetros por marca, mín/máx calculado y corregido por
  tienda y clave con historial, pedidos con renglones y visto bueno, avisos. **Todas entran al respaldo SICAR**
  (`backend/sicarRespaldo.js`) con la regla de versiones que ya existe (una copia vieja deja vacías las tablas nuevas).
- Permisos nuevos dados de alta en `backend/permisosCatalogo.js`: ver resurtido; corregir mínimos/máximos; dar visto
  bueno a la parte de su tienda; aprobar el pedido completo. El alcance de tienda sale del token, nunca del selector del
  encabezado (regla 5 de CLAUDE.md).
- Nada se escribe en SICAR. El agente sigue siendo de solo lectura.

## 7. Anti-objetivos (sería un fracaso aunque "funcione")

- Que el pedido salga solo al proveedor sin que nadie lo vea.
- Mínimos que aprenden de los días en cero y se van haciendo más chicos cada mes (espiral hacia el agotado).
- Surtir productos muertos solo porque "todo lleva mínimo".
- Corregir a mano sin dejar quién y por qué.
- Mezclar Innotec en las cuentas de Unisound.
- Que una tienda vea o apruebe lo de otra.

## 8. Entregas propuestas

1. **Cálculo + pantalla de mínimos y máximos** por tienda, con la corrección a mano y las dos listas de 6.2. Victor
   compara contra lo que conoce de cada tienda antes de que el sistema pida nada.
2. **Pedido mensual** con visto bueno de encargado y de Victor, lista para el proveedor, reparto por tienda y cierre por
   compra/traspasos.
3. **Avisos diarios** con "pasar de otra tienda" o "pedir extra".
4. (Paralelo, en el agente) historial de mostrador antes de 2025.

## 9. Lo que se deja al que planea

Fórmula exacta del colchón y su prueba con los números de San Cristóbal; cómo detectar "lo que ya viene en camino";
cómo reconocer qué compra de CEDIS corresponde a qué pedido; el formato de la lista al proveedor; dónde vive el menú.
