# Seguimiento de Facturas CEDIS — qué más se puede mejorar

Fecha: 2026-11-13. Base revisada: `master` f3c93e0 (incluye 0281897, lo último del seguimiento).
Esto es **análisis y plan**. No se cambió código, no se corrió la suite ni el navegador, no hay commit.

## Resumen para Victor

El módulo está bien cuidado en lo básico: todo cambio lleva nombre y motivo, las reglas se validan en el servidor y
no depende del selector de sucursal del encabezado. Lo que falta es que **avise de lo que hoy se queda callado**.
Ordenado por lo que te puede costar:

1. **Mercancía que salió de una tienda y no llegó completa no avisa a nadie.** Si CEDIS manda 5 y la tienda recibe 3,
   las 2 quedan en amarillo "por aclarar" para siempre: sin aviso, sin folio del traspaso, sin fecha. Lo mismo un
   traspaso que lleva semanas "en tránsito". Te cuesta el valor de esas piezas, y nadie queda señalado ni liberado.
2. **Un clic en "Revisado" apaga el aviso para siempre** en la última etapa (liquidar), y "Posponer" acepta cualquier
   fecha, hasta dentro de años. Queda quién y por qué, pero el dinero parado deja de aparecer como pendiente.
3. **Traspasos a sucursales de SICAR sin asignar (hoy la 3, la 5 y la 7) no mueven nada:** la factura sigue diciendo
   "queda en CEDIS" aunque la mercancía ya salió, y la lista no lo advierte. Las sugerencias salen sobre piezas que
   no están.
4. **La comparación contra la existencia real de SICAR solo se ve abriendo factura por factura.** Es el único lugar
   donde se notaría un ajuste de inventario hecho a mano en SICAR, y nadie lo va a ver ahí. Falta una lista.
5. **Lo que sale por cuentas internas** se mezcla en el mismo amarillo que los errores de datos. No hay un total de
   cuánta mercancía sale así.
6. **Devoluciones de clientes, ajustes y compras directas de tienda no llegan de SICAR** (límite ya conocido): una
   factura puede verse más vendida, o agotada antes, de lo que está.
7. **Si un artículo falla al recalcularse, el sistema reintenta cada segundo sin avisar** y esa factura se queda vieja
   sin que la pantalla lo diga.
8. **La pantalla no contesta "¿cuánto dinero tengo parado en total, por etapa y por tienda?"**, no exporta y muestra
   "Usuario #7" en vez del nombre.
9. **Se va a ir poniendo lenta** con más tiendas y más meses: cada consulta relee todo, en el mismo servidor que cobra.

No pude decirte **cuántos pesos** hay hoy en cada caso: eso sale de producción y no la toqué. La Fase 2 lo pone en
pantalla.

---

## Qué revisé y qué no

- **Leído completo:** `backend/seguimientoFactura/` (lector, motor, servicio, consultas, estrategias, rutas,
  incorporar, pendientes, config), `src/seguimiento/SeguimientoFacturas.jsx` y `seguimiento.js`, el diseño
  `2026-11-04-seguimiento-factura-cedis-design.md`, la memoria del proyecto, y las partes de `sicarTraspasos.js`,
  `sicarRutas.js`, `sicarRepositorio.js` y `agente-sicar/mapeo.js` que lo tocan.
- **No hice:** correr pruebas, levantar servidores, abrir el navegador, ni consultar producción. Los montos y
  frecuencias reales son desconocidos; donde digo "inferido" es razonamiento sobre el código, no un caso reproducido.
- **Git:** `master` sin cambios en archivos con seguimiento al empezar.

### Lo que la memoria daba por pendiente y ya está hecho (según la memoria, no verificado en producción)

- Consulta del factor en CEDIS y agente CEDIS actualizado: hechos el 2026-11-05 (factor `decimal(20,3)`).
- CEDIS, Ocosingo y San Cristóbal incorporadas el 2026-11-06. Rescate de la ventana en `master` (b7c9106).

### Lo que sigue pendiente de verdad (según la memoria)

1. Verificación de hoy: ACR 7264 con 93 piezas en Ocosingo y $83,492.25 con IVA; C 32194 rescatada en Yajalón contra
   SICAR; la nota del rescate en pantalla; avisos nuevos tras la vuelta diaria.
2. Confirmar en la pestaña Tiendas que Yajalón y Palenque aparecen incorporadas (el índice de memoria todavía dice
   "falta seguimiento" en las dos).
3. Sucursales SICAR 3, 5 y 7 sin asignar en el mapa (ver hallazgo 3).
4. Dar `ver_` y `gestionar_seguimiento_facturas` a Compras (el Administrador ya los tiene).
5. Contraseñas débiles de MySQL en las PCs de tienda.
6. Ventanas nocturnas del agente con PCs que se apagan a las 18:00 (ver hallazgo 10).
7. Innotec: sin agente; lo que se le mande queda gris.

Orden recomendado: 1 y 2 hoy (son solo mirar), 3 con la Decisión D4, 4 cuando esté la Fase 1, el resto después.

---

## Hallazgos a detalle

### 1. Piezas perdidas en el camino: no avisan, no tienen folio ni edad

- **Quién / qué aprieta:** nadie tiene que hacer nada raro. En SICAR se envía un traspaso de 5 y el destino aplica 3;
  o se envía y el destino nunca lo aplica.
- **Cuánto:** el costo de las piezas que no llegaron. Sin tope.
- **Qué queda registrado:** el renglón de la factura marca piezas en "Movimientos por aclarar" con el texto "Llegaron
  menos piezas de las enviadas". No queda **qué traspaso**, **qué día**, ni **entre qué tiendas**.
- **Verificado:**
  - La diferencia va a "por aclarar": `motor.js:140-144`. Un envío sin recibir se queda en tránsito sin fecha:
    `motor.js:92-98`.
  - Los avisos solo cuentan queda + tránsito; lo "por aclarar" no genera aviso nunca: `servicio.js:40-42`,
    `consultas.js:107,113`.
  - Lo que se guarda por renglón no trae folio ni fecha del traspaso: `servicio.js:90`.
  - La lista no tiene filtro de "por aclarar" ni de tránsito: `consultas.js:139-151`.
- **Inferido:** que esto esté pasando hoy y por cuánto.
- **A quién le cae:** a nadie, y ese es el problema. Tampoco protege a la encargada honesta: si el faltante se
  descubre meses después, no hay registro de que ella recibió 3 y lo reportó a tiempo.
- **Cómo se cierra:** guardar por cada pieza en tránsito o por aclarar el folio, la fecha de envío, origen y destino;
  pestaña "En el camino y por aclarar" con días y dinero; aviso cuando un tránsito pase de N días (Fase 2).

### 2. "Revisado" calla para siempre y "Posponer" no tiene tope

- **Quién:** cualquiera con `gestionar_seguimiento_facturas`.
- **Qué aprieta:** "Revisado" con un motivo de 3 letras, o "Posponer" con una fecha lejana.
- **Cuánto:** el aviso deja de estar "nuevo". En la etapa de liquidar (la última) ya no hay etapa siguiente que lo
  despierte: la factura puede quedarse parada indefinidamente con su saldo completo.
- **Qué queda registrado:** quién, cuándo y el motivo (bien). No queda qué se hizo, y el sistema no comprueba si
  después hubo traslado o si el saldo bajó.
- **Verificado:** un aviso solo vuelve a "nuevo" si estaba retirado o si venció una posposición: `servicio.js:43-53`,
  `servicio.js:100-108`. Posponer solo exige fecha futura, sin máximo: `rutas.js:34-39`. No hay ninguna vista de
  "avisos revisados o pospuestos con saldo que no se movió".
- **Cómo se cierra:** "Revisado" caduca a los N días si el saldo no bajó (vuelve como nuevo, con historial "sin
  movimiento desde la revisión"); tope de días para posponer; todo en el servidor (Fase 1, Decisión D1).

### 3. Traspasos que el sistema no entiende dejan la mercancía "en CEDIS"

- **Qué pasa:** si el traspaso va a un número de sucursal SICAR sin asignar en el mapa, o el folio es ambiguo, el
  sistema lo anota como observación y **no mueve piezas**. La factura sigue mostrando esas piezas como "Queda" en el
  origen, con avisos y sugerencias de traslado calculados sobre mercancía que ya no está ahí.
- **Verificado:**
  - Motivos `sin_mapa`, `mapa_contradictorio`, `folio_ambiguo` → solo observación: `lector.js:180-188`,
    `lector.js:193-206`. El motor las salta sin mover: `motor.js:234-237`.
  - La lista no lo advierte: "Siguiente acción" no mira esas marcas (`src/seguimiento/seguimiento.js:99-115`); solo se
    ve abriendo la factura, renglón por renglón.
  - Cambiar el mapa no recalcula nada; se corrige hasta la vuelta del día siguiente: `sicarTraspasos.js` (función
    `asignarMapaSicar`, ≈169-196) y `sicarRutas.js:230-233`.
- **De la memoria (no verificado en producción):** el mapa estuvo vacío hasta el 2026-11-11 y por eso ACR 7264 no
  bajaba; hoy siguen sin asignar las SICAR 3, 5 y 7.
- **A quién le cae:** a Compras, que recibe una sugerencia de traslado o de bajar precio sobre piezas inexistentes.
- **Cómo se cierra:** marca visible en la lista ("traspasos sin entender: revisar"), aviso fijo arriba mientras haya
  sucursales SICAR sin asignar, y recálculo inmediato al cambiar el mapa (Fase 2). Decisión D4.

### 4. La comparación contra SICAR está escondida

- **Qué pasa:** el sistema ya compara, por artículo y tienda, lo que calcula contra la existencia real de SICAR. Pero
  solo al abrir una factura, y no se guarda.
- **Verificado:** se calcula al vuelo dentro del detalle: `consultas.js:298-307` y `consultas.js:322`. No hay ruta ni
  pantalla que liste diferencias.
- **Inferido (importante):** como no llegan devoluciones ni ajustes de inventario de SICAR (diseño §3), esa
  diferencia es justo la huella de un ajuste manual, una devolución o una compra directa de tienda. Es el detector de
  fuga de inventario más barato que tienes y hoy nadie lo mira.
- **Cuidado con las personas:** el texto actual dice "movimientos por aclarar", nunca "faltante". Hay que conservarlo:
  una diferencia aquí no prueba nada contra una encargada; solo dice dónde preguntar.
- **Cómo se cierra:** guardar la diferencia en cada recálculo y una pestaña "Diferencias contra SICAR" ordenada por
  dinero, con desde cuándo existe (Fase 5).

### 5. Las salidas a cuentas internas se pierden entre los errores

- **Qué pasa:** una venta a una cuenta interna sí saca mercancía. El sistema la manda al amarillo "por aclarar", junto
  con los problemas de datos, y ahí se queda.
- **Verificado:** `lector.js:124-139` (se marca `cuenta_interna`), `motor.js:157-160` (va a "por aclarar").
- **Cuánto:** desconocido; no hay un total en ninguna parte del módulo.
- **Cómo se cierra:** depende de ti (Decisión D2). Recomiendo un tramo propio "Uso interno", con dinero, para que el
  amarillo quede solo para lo que de verdad hay que aclarar.

### 6. Devoluciones, ajustes y compras directas de tienda no llegan

- **Qué pasa:**
  - Cliente devuelve una pieza: SICAR la regresa a existencia; el seguimiento la sigue contando vendida.
  - Una tienda compra directo el mismo artículo: el seguimiento no ve esas piezas y da la factura de CEDIS por agotada
    antes de tiempo.
  - Ajuste de inventario en SICAR: invisible.
- **Verificado:** solo se leen compras de CEDIS (`lector.js:98`) y ventas vigentes (`lector.js:132`); el agente no lee
  ninguna tabla de devoluciones ni de ajustes (búsqueda en `agente-sicar/`, sin resultados). El diseño lo declara
  como límite (§3 y §10).
- **Inferido:** qué tan seguido pasa. El hallazgo 4 lo mediría sin tocar el agente.
- **Cómo se cierra:** primero medir con la Fase 5; si pesa, reconocimiento de SICAR y actualización del agente
  (Fase 7, Decisión D5). Es lo más caro del plan.

### 7. Fallas silenciosas del recálculo

- **Qué pasa:** si un artículo truena al recalcularse, se manda al final de la fila y se reintenta cada segundo, para
  siempre, y el error se tira sin escribirse en ningún lado. Sus facturas se quedan con el cálculo viejo.
- **Verificado:** el ciclo solo lee cuántas quedan y descarta la lista de errores: `rutas.js:128`; el reintento:
  `servicio.js:127-130` y `rutas.js:131`. La pantalla muestra "Datos al" (frescura de lo que mandó SICAR), no cuándo
  se calculó; `calculado_en` se guarda y no se enseña.
- **Inferido:** que haya hoy algún artículo atorado.
- **Cómo se cierra:** contar intentos, dejar de reintentar tras N fallas, escribir el error, y un renglón de salud en
  la pantalla: "última vuelta, artículos en fila, artículos con error" (Fase 3).

### 8. Lo que la pantalla no contesta

Verificado en `SeguimientoFacturas.jsx` y `consultas.js`:

- No hay totales: dinero parado por etapa, por tienda, por proveedor (`listar` devuelve solo la página).
- No hay exportar.
- No hay filtro por "tiene por aclarar", "tiene tránsito" o "tiene gris".
- El historial dice "Usuario #7", no el nombre: `SeguimientoFacturas.jsx:220` y `:413`.
- Lo vendido por tienda se calcula y no se muestra (`motor.js:186-187` contra `SeguimientoFacturas.jsx:156-159`).
- El menú no avisa cuántos avisos nuevos hay; hay que entrar a ver.
- No existe la vista para encargados (el diseño la deja "para después", solo su tienda y sin costos).

### 9. Velocidad con más tiendas y más meses

- **Verificado:**
  - La lista lee y desarma **todos** los resultados guardados y todas las compras de CEDIS en cada consulta, y luego
    pagina en memoria: `consultas.js:22-33` y `:162-180`.
  - La vuelta diaria vuelve a marcar **todo** artículo que alguna vez tuvo resultado, aunque su factura lleve meses
    agotada: `servicio.js:140-152`.
  - Para cada artículo se leen sus ventas de toda la historia y se filtran después por fecha: `lector.js:127-134`.
  - El detalle corre varias consultas por cada renglón y por cada tienda: `consultas.js:208-228`, `:259-291`, `:320-322`.
- **De la memoria:** con 30 mil ventas la prueba integrada tardó ~330 ms; el detalle llegó a tardar 9.5 s antes de
  los índices.
- **Inferido:** con 5 a 7 tiendas y un año de facturas la lista y la vuelta diaria crecerán mes a mes. El servidor
  es el mismo que cobra y atiende una cosa a la vez: una consulta lenta aquí es una caja esperando.
- **Cómo se cierra:** guardar un resumen por factura al recalcular; dejar de recalcular a diario lo agotado y
  estable; acotar las ventas por fecha en la consulta (Fase 6). Medir antes y después con datos del tamaño real.

### 10. Menores

- **Venta de la mañana contra compra del mediodía (verificado, `lector.js:385-388`):** dentro de un mismo día se
  ordena por tipo y no por hora. Si la tienda no tenía existencia anterior, una venta de las 10:00 puede cargarse a
  una factura que llegó a las 12:00. Solo aplica a ventas en CEDIS el día de la compra; bajo costo.
- **Ventanas nocturnas del agente (de la memoria, no revisado en código):** con las PCs apagadas a las 18:00, la
  relectura completa de compras y traspasos solo ocurre cuando el agente la fuerza a los 8 días. Una compra corregida
  en SICAR podría tardar hasta una semana en reflejarse.
- **Permiso de ver (verificado, `rutas.js:103-114`):** `ver_seguimiento_facturas` enseña los costos de todas las
  facturas de todas las tiendas, sin recorte por tienda. Es lo acordado para ti y Compras; **no dárselo a un
  encargado** hasta que exista su vista.

### Lo que revisé y está bien (verificado)

- Motivo, fecha de posposición, rangos de configuración y permisos se validan en el servidor: `rutas.js:20-89`.
- Quién hizo cada cosa sale siempre del token, nunca del cuerpo: `rutas.js:96`.
- No se usa `?sucursal_id=` para decidir alcance; el filtro se llama `tienda` y solo filtra: `consultas.js:137-138`.
- Incorporar una tienda queda con nombre, rechaza foto vieja y no se puede repetir: `incorporar.js:41-50`.
- El dinero de cada factura cuadra al centavo entre sus cinco tramos: `motor.js:167-178`.

---

## Plan por fases

Cada fase se entrega sola. En todas: TDD con prueba roja primero, ninguna dependencia nueva, líneas de menos de 200
caracteres, revisión independiente y prueba en navegador antes de tu merge.

### Fase 1 — Avisos que no se callan solos (hallazgo 2)

- **Qué:** "Revisado" caduca si el saldo no bajó en N días; tope de días para posponer; ambos configurables.
- **Archivos:** `backend/seguimientoFactura/servicio.js`, `rutas.js`, `config.js`, `sicarRepositorio.js` (columna de
  saldo al revisar), `src/seguimiento/SeguimientoFacturas.jsx`, `seguimiento.js`.
- **Pruebas:** revisado con saldo igual a los N días vuelve a nuevo con historial; con saldo menor no vuelve;
  posponer más allá del tope se rechaza en el servidor mandando la petición a mano; etapa liquidar incluida.
- **Navegador:** marcar revisado, adelantar con datos sembrados y ver que reaparece; intentar posponer un año.
- **Tamaño:** chica.

### Fase 2 — En el camino y por aclarar, con folio, días y dinero (hallazgos 1 y 3)

- **Qué:** guardar folio, fecha, origen y destino de cada pieza en tránsito o por aclarar; pestaña nueva ordenada por
  dinero y antigüedad; aviso de tránsito viejo; marca en la lista para facturas con traspasos sin entender; aviso fijo
  de sucursales SICAR sin asignar; recálculo al cambiar el mapa.
- **Archivos:** `motor.js`, `lector.js` (solo pasar datos que ya lee), `servicio.js` (versión 3 de resultados),
  `consultas.js`, `rutas.js`, `sicarTraspasos.js` o `sicarRutas.js` (marcar pendientes al cambiar el mapa),
  `SeguimientoFacturas.jsx`, `seguimiento.js`.
- **Pruebas:** recepción menor conserva folio y tiendas; tránsito de más de N días aparece en la lista nueva; traspaso
  sin mapa marca la factura; cambiar el mapa deja las claves pendientes; la suma de tramos sigue cuadrando al centavo.
- **Navegador:** sembrar un traspaso 5 enviado / 3 recibido y uno sin recibir; verlos en la pestaña con folio y días.
- **Tamaño:** mediana. Es la que más protege.

### Fase 3 — Salud del cálculo a la vista (hallazgo 7)

- **Qué:** contar intentos fallidos, parar tras N, escribir el error; renglón de salud en la pantalla; mostrar
  "calculado el".
- **Archivos:** `servicio.js`, `rutas.js`, `sicarRepositorio.js` (columnas en la fila de pendientes), `consultas.js`,
  `SeguimientoFacturas.jsx`.
- **Pruebas:** una clave que siempre falla deja de reintentarse y aparece contada; las demás siguen avanzando.
- **Navegador:** ver el renglón de salud con y sin fila pendiente.
- **Tamaño:** chica.

### Fase 4 — Resumen, filtros, nombres y exportar (hallazgo 8)

- **Qué:** encabezado con dinero parado por etapa y por tienda; filtros de por aclarar / tránsito / gris; nombres en
  el historial; vendido por tienda en el detalle; exportar la lista filtrada a CSV generado en el navegador (sin
  archivo en Render); contador de avisos nuevos en el menú.
- **Archivos:** `consultas.js`, `rutas.js`, `SeguimientoFacturas.jsx`, `seguimiento.js`, `src/BarraLateral.jsx`.
- **Pruebas:** los totales del encabezado son la suma exacta de las facturas filtradas; el CSV trae lo mismo que la
  pantalla; el contador respeta el permiso.
- **Navegador:** comparar a mano el total del encabezado contra tres facturas; abrir el CSV en Excel con acentos.
- **Tamaño:** mediana.

### Fase 5 — Diferencias contra SICAR y uso interno (hallazgos 4 y 5)

- **Qué:** guardar la diferencia por artículo y tienda en cada recálculo; pestaña "Diferencias contra SICAR" con
  dinero y desde cuándo; tramo "Uso interno" si eliges la opción recomendada en D2.
- **Archivos:** `servicio.js`, `consultas.js`, `motor.js` (tramo nuevo), `rutas.js`, `SeguimientoFacturas.jsx`,
  `seguimiento.js`.
- **Pruebas:** diferencia cero no aparece; existencia atrasada o clave repetida aparece como "no se puede comparar" y
  nunca como diferencia; el tramo nuevo conserva la suma al centavo.
- **Navegador:** que ningún texto diga "faltante"; revisar el tramo nuevo en la barra y la leyenda.
- **Tamaño:** mediana.

### Fase 6 — Velocidad (hallazgo 9)

- **Qué:** resumen por factura guardado al recalcular; lista paginada desde ese resumen; no recalcular a diario lo
  agotado y estable; ventas acotadas por fecha en la consulta.
- **Archivos:** `servicio.js`, `consultas.js`, `lector.js`, `sicarRepositorio.js`, `sicarRespaldo.js` (tabla nueva en
  el respaldo), `integracion.test.js`.
- **Pruebas:** mismos resultados que antes con el juego de datos integrado; medición antes y después con volumen de un
  año y siete tiendas.
- **Navegador:** lista y detalle de una factura de 90 renglones, tiempos anotados.
- **Tamaño:** mediana, con riesgo: toca el corazón del cálculo. Hacerla sola, sin mezclar con otra.

### Fase 7 — Lo que no llega de SICAR (hallazgo 6)

- **Qué:** reconocimiento en SICAR (solo lectura) de cómo guarda devoluciones, ajustes y compras de tienda; luego
  agente, servidor y motor.
- **Archivos:** `agente-sicar/mapeo.js`, `formato.js`, `corrida.js`; `backend/sicarRepositorio.js`; `lector.js`,
  `motor.js`.
- **Condiciones:** actualizar el agente en cada PC en horario de tienda y dejarlo comprobado antes de las 17:45.
- **Tamaño:** grande. Solo si la Fase 5 demuestra que pesa.

### Fase 8 — Vista para encargados

- **Qué:** cada encargado ve lo parado en **su** tienda, sin costos, con las sugerencias de traslado que le tocan.
- **Regla dura:** el alcance sale del token (su sucursal y su permiso de ver todas), nunca del selector del
  encabezado. Permiso nuevo y propio en `permisosCatalogo.js`.
- **Tamaño:** mediana. Después de la Fase 2, para que lo que vean sea confiable.

### Orden recomendado

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Las tres primeras son las que cierran silencios; la 4 es la que más vas a notar tú;
la 5 es la que puede encontrar fugas; la 6 hay que hacerla antes de que duela, no después.

---

## Decisiones de Victor

**D1. ¿Cuánto dura un "Revisado" y cuánto se puede posponer?**
- A) Revisado caduca a los 15 días sin movimiento; posponer máximo 30 días. Costo: Compras verá reaparecer avisos.
- B) Revisado caduca solo al cambiar de etapa (como hoy) y posponer máximo 30 días. Costo: la etapa de liquidar sigue
  pudiendo callarse para siempre.
- C) Dejarlo como está. Costo: cero trabajo; el hueco queda.
- **Recomiendo A**, con los dos números configurables.

**D2. ¿Cómo se cuenta lo que sale por cuentas internas?**
- A) Tramo propio "Uso interno" con dinero. Costo: un color más en la barra.
- B) Contarlo como vendido. Costo: la factura se ve mejor de lo que es; se pierde de vista cuánto sale así.
- C) Dejarlo en "por aclarar". Costo: el amarillo nunca llega a cero y deja de significar algo.
- **Recomiendo A.**

**D3. ¿A los cuántos días un traspaso "en tránsito" es alarma, y quién la ve?**
- A) 7 días, lo ven tú y Compras. B) 3 días. C) 15 días.
- **Recomiendo A** para empezar, configurable. Dime si entre tus tiendas un envío normal tarda más.

**D4. ¿Qué tiendas son las sucursales SICAR 3, 5 y 7?**
- Solo tú lo sabes (se sospecha Innotec y MercadoLibre). Mientras no se asignen, lo que se mande ahí sigue viéndose
  "en CEDIS". Si alguna ya no existe, hay que decidir si esos traspasos se tratan como gris.

**D5. ¿Vale la pena traer devoluciones, ajustes y compras de tienda desde SICAR?**
- A) Esperar a la Fase 5 y decidir con el número en la mano. Costo: nada ahora.
- B) Hacerlo ya. Costo: reconocimiento en SICAR más actualizar el agente en cada PC de tienda.
- **Recomiendo A.**

**D6. ¿Cuándo entra la vista de encargados, y con qué?**
- A) Después de la Fase 2, solo su tienda y sin costos. B) No por ahora.
- **Recomiendo A.** Antes de la Fase 2 les enseñaría sugerencias sobre mercancía que puede no estar.

**D7. ¿Cómo sale de SICAR la mercancía que se vende por MercadoLibre?**
- Es pregunta, no opción. Si esas ventas no se registran en el SICAR de CEDIS, las facturas se verán paradas cuando
  en realidad se vendieron. No lo pude confirmar leyendo el código: necesito que me digas cómo lo hacen hoy.

**D8. ¿Quieres el aviso fuera de la pantalla?**
- A) Contador de avisos nuevos en el menú (incluido en la Fase 4). B) Además un resumen diario dentro del sistema.
  C) Nada. WhatsApp quedó fuera en el diseño y no lo propongo.
- **Recomiendo A.**
