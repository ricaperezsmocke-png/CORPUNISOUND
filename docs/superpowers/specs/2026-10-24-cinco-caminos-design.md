# Cinco Caminos en los objetivos de venta — diseño

Fecha: 2026-10-24. Base: `master` 3b997e1. Rama `feature/cinco-caminos`, worktree `.claude/worktrees/cinco-caminos`.
Fuente: hoja "Cinco Caminos de ActionCOACH" (`C:\Users\Victor\Desktop\UNISOUN IA\Hoja de 5 caminos.pdf`), analizada
por dos agentes (estratega y analista de mejoras de venta) y revisada contra el código actual.

Lo marcado **(Claude)** lo decidió Claude; Victor lo revisa al leer.

## 1. Para qué

Que la hoja de los Cinco Caminos no se quede en la pared: que cada tienda sepa cada semana sus cinco números, que cada
mes trabaje **un camino y dos tácticas** elegidos para ella, y que lo que funcione en una tienda se **pruebe y se
replique** en las demás.

La fórmula: prospectos × conversión = clientes; clientes × compras por cliente × venta promedio = ingreso;
ingreso × margen = ganancia. Mejorar un poco cada número multiplica la ganancia.

**Éxito (piloto Ocosingo, 90 días):**
- El tablero muestra cada lunes los números reales de la semana, calculados solos desde SICAR y el Radar.
- Cada mes hay un camino y dos tácticas aprobados por el gerente para Ocosingo, con metas que se miden solas.
- Al cerrar el mes, el sistema dice si cada táctica movió su número sin tumbar su candado, y la etiqueta en el manual.
- Indicadores a 90 días contra el mismo mes de 2025: % de tickets con cliente +20 puntos (mínimo 50%); ticket promedio
  +8% sin bajar artículos por ticket; conversión del Radar +5 puntos con registros por cada 10 tickets estables o al
  alza; juntas del lunes hechas ≥ 90%.

## 2. Decisiones de Victor (2026-10-24)

- **Quién elige:** el **gerente de ventas**, con la propuesta de la IA como base. La IA nunca crea nada sola.
- **Estrategia por tienda:** cada tienda recibe su propio camino y tácticas según sus números.
- **Replicar lo probado:** lo que funcione en una tienda se propone a las demás.
- **Piloto en Ocosingo.** Cuando el tablero y el ciclo funcionen, se conectan los agentes SICAR de San Cristóbal,
  Palenque, Yajalón e Innotec; el diseño ya contempla varias tiendas.
- **Las ventas a público en general SÍ se mandan** (opción B, 2026-10-24): sin ningún dato de persona, para que el
  tablero mida la tienda completa (sección 4.3).
- **Se crea un usuario "Gerente de ventas" que ve todas las tiendas** (sección 7.1). Lo da de alta Victor en Roles y
  Personal.

## 3. Principios

- **Se mide, no se declara.** Los cinco números salen de SICAR, el Radar, el CRM y (después) la bandeja. Las capturas de
  la vendedora siguen existiendo para actividades con evidencia, pero no para los números del tablero.
- **Cada tienda contra sí misma:** contra el mismo mes/semanas de 2025 y sus últimas 8 semanas. No contra la "mediana de
  la red" (con 4–5 tiendas no sirve) **(analista)**.
- **Cada número lleva su candado:** una táctica no cuenta como éxito si sube su número tumbando otro (tabla 4.1).
- **No inventarle faltantes a gente honesta:** nadie carga una meta que no controla; con pocos datos el sistema dice
  "sin dato"; una meta no cumplida abre revisión, nunca castigo automático.
- **Solo observar SICAR.** Nada de esto toca catálogo, precios, existencias ni caja de CORPUNISOUND.

## 4. El tablero semanal de los cinco números

Una sola hoja por tienda, legible en el celular o impresa, para la junta del lunes. Semana = lunes a domingo,
`America/Mexico_City`. Cada número con: valor de la semana, flecha contra la semana anterior, valor de la misma semana
de 2025, promedio de las últimas 8 semanas, y semáforo (Claude: verde ≥ base, ámbar hasta −5%, rojo peor). **La base
del semáforo es la misma semana de 2025; si no existe (Radar, tiendas nuevas), el promedio de 8 semanas** (Claude).

### 4.1 Números (piloto: por tienda)

| Camino | Número | Definición | Fuente | Candado |
|---|---|---|---|---|
| Calidad del dato | % tickets con cliente | ventas vigentes con cliente ÷ (ventas vigentes con cliente + ventas de mostrador vigentes) | sicar_ventas + mostrador (4.3) | — |
| Prospectos | Clientes nuevos | clientes cuya **primera** compra SICAR cae en la semana | sicar_ventas | % con cliente |
| Conversión | Conversión del Radar | demanda CONVERTIDA ÷ (CONVERTIDA + NO_CONVERTIDA) de la tienda (cálculo existente de `radar/metricas.js`) sobre lo **registrado hace 30 a 60 días** (Claude: lo reciente sigue pendiente y saldría falso); se compara solo contra sus 8 semanas (el Radar no tiene 2025) | Radar | registros del Radar por cada 10 tickets (si cae >30% contra su base, la conversión se marca "no confiable") |
| Compras por cliente | Recompra a 90 días | % de clientes identificados que compraron en la semana y ya habían comprado en los 90 días previos (Claude) | sicar_ventas | % con cliente |
| Venta promedio | Ticket promedio | total vigente ÷ número de ventas vigentes, neto de cancelaciones, con cliente y de mostrador | sicar_ventas + mostrador | artículos por ticket |
| Venta promedio | Artículos por ticket | suma de cantidades ÷ ventas vigentes (con cliente y mostrador) | sicar_detalles + detalle de mostrador | ticket promedio |
| Venta promedio | % instrumento con accesorio | ventas con al menos un artículo de categoría "instrumento" que también llevan uno de categoría "accesorio" ÷ ventas con instrumento | detalles (con cliente y mostrador) + sicar_articulos (categoría/departamento) | — |
| Margen | (fase 3) Margen bruto y descuento promedio | requiere costo desde SICAR (sección 8) | — | — |

- **Qué categorías son "instrumento" y cuáles "accesorio":** pantalla de configuración donde el gerente marca las
  categorías/departamentos de SICAR (las de `sicar_articulos`). Sin marcar → ese número sale "sin configurar".
- **"Sin dato":** si la semana tiene menos de 30 ventas (Claude) o la tienda no tiene agente, el número sale "sin dato"
  y no se califica.
- **Venta de la tienda** (total vigente de la semana contra la misma de 2025) va arriba como contexto, no como camino.

### 4.3 Ventas de mostrador (público en general)

Hoy el agente NO manda las ventas a público en general (`agente-sicar/formato.js`: ids `PUBLICOS` y nombre "PÚBLICO EN
GENERAL"), y el servidor solo guarda ventas con cliente. Sin ellas, ticket, número de ventas y % con cliente serían
falsos. Decisión de Victor: mandarlas.

- **Colección nueva y aparte `mostrador`** (Claude): no se mezclan con `ventas` para que nada del CRM (fichas, VIP,
  "qué compra", vínculos, estados) las vea nunca. Fila: `{ ven_id, fecha_local, estado ('vigente'|'cancelada'),
  total, detalle: [{ art_id, cantidad, importe_con, descuento_total }] }`. **Sin** cliente, nombre, teléfono,
  descripción ni clave del artículo (el artículo se cruza por `art_id` con `sicar_articulos`).
- **Servidor:** tablas `sicar_ventas_mostrador` y `sicar_detalles_mostrador`, en el respaldo de Drive (generación
  nueva). Mismas reglas de importe exacto en centavos y de contrato estricto que `ventas`.
- **Agente:** interruptor `"mostrador"`; cursor propio por `ven_id`; cancelaciones por el mismo mecanismo de historial
  y ventana de 48 h que ya usan las ventas, aplicado a las de público; carga histórica **desde 2025-01-01** (Claude: basta
  para comparar contra el mismo mes del año anterior), de noche, en lotes.
- **Una venta que cambia de cliente** (de público a cliente o al revés) se mueve: sale de una tabla y entra a la otra;
  nunca cuenta dos veces. El tablero cuenta ventas = `sicar_ventas` vigentes + `sicar_ventas_mostrador` vigentes.
- **Tiendas nuevas:** antes de prender `mostrador`, confirmar con `--verificar` sus ids de público en general (la lista
  actual es la de Ocosingo); si no, sus ventas de mostrador entrarían como clientes y se inflarían "% con cliente" y
  "clientes nuevos".

### 4.2 Más adelante (cuando haya datos)
- Por vendedor (sección 8: `vnd_id` de SICAR).
- Prospectos desde la bandeja (conversaciones nuevas) cuando se conecte Meta.
- Seguimiento del Radar ligado a la venta (táctica 2).

## 5. El manual de tácticas

Catálogo dentro del sistema, editable por quien tenga permiso (gerente/dueño). Cada táctica:
- nombre corto y descripción ("Kit de instrumento: funda, afinador y cuerdas"),
- camino y **número que mueve** (de la tabla 4.1) y su candado,
- quién la ejecuta (vendedor, encargado, compras, gerente),
- cómo se comprueba que se hizo: por número del sistema, o por evidencia (foto/lista/liga) con las reglas ya existentes,
- referencia a la hoja (número de táctica del PDF),
- **etiqueta de prueba** por tienda: `por probar`, `probada` (con mes y resultado), `no funcionó` (con mes), `sin dato`;
  y una etiqueta general `probada en N tiendas`.

**Primera versión (Claude):** las 30 tácticas recomendadas por los agentes, adaptadas a Unisound, para que Victor y el
gerente las corrijan. Incluye como mínimo: no-venta al Radar con motivo; seguimiento en 48 h a intención alta; teléfono
en ventas > $500; kit instrumento + accesorios; ofrecer Coppel Pay/Atrato > $3,000; recordatorio de cuerdas 60–90 días;
reactivar VIP sin compra en 6 meses; alianzas con iglesias/escuelas/maestros con "¿quién te mandó?"; prueba en tienda y
clínica mensual; los 20 más pedidos del Radar nunca en cero (Compras); descuento solo con permiso; rematar lo de más de
180 días con margen mínimo.
**Excluidas a propósito:** 2x1/4x3 y descuentos como táctica; deshacerse de clientes C/D; subir precios contra
MercadoLibre; comprar o vender bases de datos (ilegal); subir niveles de crédito; equipos solo a comisión.

## 6. El ciclo mensual por tienda

1. **Diagnóstico (día 1 del mes, o a pedido del gerente):** la IA recibe los números de la tienda (4.1) de las últimas
   8 semanas y del mismo mes de 2025, el manual con sus etiquetas, y las tácticas usadas en meses anteriores con su
   resultado. Propone: **el camino más débil** con su "por qué" en números, **2 tácticas** del manual (prefiere las
   `probadas` en otra tienda para ese mismo camino, citando el resultado), y **hasta 3 metas** con cifra, responsable y
   candado.
2. **Reglas de la IA:**
   - Primero la calidad del dato: con % de tickets con cliente < 50%, el camino del mes es "calidad del dato".
   - La meta va a quien controla la palanca: falta de existencia → Compras, nunca la vendedora.
   - Nunca proponer descuento para un problema de conversión o existencia.
   - Mejoras de +5% a +15% sobre la base propia; nada con "sin dato".
   - Considera la temporada (diciembre, enero, regreso a clases, fiestas patronales) comparando contra el mismo mes de
     2025.
   - No inventa números: todo número del "por qué" debe estar en los datos enviados (validación como la actual).
3. **Aprobación:** el gerente de ventas acepta, cambia o rechaza cada punto (camino, tácticas, metas), como hoy con el
   planeador. Lo aprobado crea las metas del mes de la tienda. La IA propone el **responsable como rol** ("vendedores de
   la tienda", "encargado", "Compras"); el gerente elige la cuenta al aprobar (Claude: la IA no conoce nombres).
   - **Formato del modo cinco caminos** (Claude): de 1 a 3 metas; la cifra puede ser porcentaje (con un decimal) o pesos
     (centavos enteros) según el número; tope = base propia +15% (no "3 veces el máximo", que es para conteos). Las
     guardas actuales del planeador (límite diario, sin nombres, números del "por qué" solo de los datos, periodos
     sellados) se mantienen.
4. **Junta del lunes:** el tablero muestra el camino y las 2 tácticas del mes con su avance y una lista de compromisos
   (texto, responsable, fecha, hecho/no hecho) que se tachan. El encargado marca **"junta hecha"** en el tablero al
   capturar los compromisos de esa semana (Claude); de ahí sale el indicador "juntas hechas ≥ 90%".
5. **Cierre del mes:** para cada táctica el sistema calcula si **se hizo** (evidencia o número) y si **su número se movió**
   contra el mismo mes de 2025 y contra las 8 semanas previas, **sin que caiga su candado**. Resultado: `probada`,
   `no funcionó`, `no se hizo` (no cuenta) o `sin dato`. Queda en la etiqueta de la táctica para esa tienda. Reglas
   (Claude):
   - "se movió" = el número mejora **al menos 5%** contra el mismo mes de 2025 (o contra sus 8 semanas previas si no hay
     2025);
   - "cayó el candado" = el candado empeora **más de 5%** contra la misma base (para el Radar, la regla de 30% de 4.1);
   - dos tácticas del mismo mes que mueven el mismo número quedan `probada en conjunto`.
6. **Replicar:** en el diagnóstico de otra tienda con el mismo camino débil, la IA propone primero lo `probado`, con la
   cifra. El gerente decide.

## 7. Cómo encaja con lo que ya existe

- **Metas:** las metas del mes se crean como metas personalizadas (`metasPersonalizadas.js`) con alcance tienda o
  persona. Hace falta un tipo de meta que **se mida sola** con los números 4.1 (hoy las fuentes automáticas solo existen
  para el corporativo y solo cuentan eventos) **(Claude:** nueva familia de fuentes `cinco_caminos:<numero>` válida para
  alcance tienda; la meta es un valor objetivo del número, no un conteo**)**.
- **Planeador IA:** se extiende el planeador existente (`planIA*.js`) con un modo "cinco caminos": recibe los datos de
  4.1 y el manual; su esquema de salida agrega `camino`, `tacticas` y `candado`. Mantiene sus guardas actuales
  (límite diario, sin nombres, validación de cifras, aprobación punto por punto, periodos sellados).
- **Permisos (Claude):** `ver_cinco_caminos` (tablero), `administrar_manual_tacticas` (editar manual y categorías),
  y la aprobación del plan usa el permiso existente de aprobar planes de IA (`administrar_metas_personalizadas`).
  Además `marcar_junta_cinco_caminos` (junta y compromisos, para encargados). Alcance por token (regla 5): sin
  `ver_todas_las_sucursales`, solo su tienda.

### 7.1 El usuario "Gerente de ventas" (decisión de Victor)
Un rol "Gerente de ventas" con: `ver_todas_las_sucursales`, `ver_cinco_caminos`, `administrar_manual_tacticas`,
`administrar_metas_personalizadas`, `usar_gerente_ventas`, `ver_radar_demanda` y los de ver existencias y cortes SICAR.
**Victor crea el rol y el usuario** en Roles y Personal (el sistema solo reconcilia el rol Administrador; ninguna cuenta
se crea en código). Este rol aprueba la estrategia de cada tienda, ve todas para replicar y asigna metas a Compras.
- **Pantallas:** una pestaña "Cinco caminos" en Objetivos con el tablero de la tienda, el plan del mes y los compromisos;
  una pestaña "Manual de tácticas"; y el planeador en modo cinco caminos.
- **Respaldo:** todo lo nuevo que no viva en el JSON principal entra al respaldo de Drive.

## 8. Datos que faltan (por fases)

- **Fase piloto:** la colección `mostrador` (4.3) en el agente y el servidor; lo demás sale de `sicar_ventas`,
  `sicar_detalles`, `sicar_articulos` y el Radar.
- **Fase 2 — vendedor:** el agente manda `vnd_id` de cada venta SICAR. **Antes de usarlo para metas por persona**
  confirmar en SICAR quién teclea el vendedor y si se puede cambiar después; sin eso, alguien podría apuntarse ventas
  ajenas.
- **Fase 3 — costo:** el agente manda el costo (`articulo.preCompraProm` o `precioCompra`, a confirmar con
  --verificar) para margen y descuento promedio.
- **Otras tiendas:** al instalar su agente y confirmar sus ids de público en general (4.3) entran al tablero; cada una
  se compara contra su propia historia. Hoy el servidor solo acepta el mapeo `ocosingo-f0-v1` (`sicarIngesta.js`):
  cada tienda nueva necesita revisar si su SICAR usa el mismo esquema.

## 9. Cómo se abusa y qué queda

- **Inflar conversión dejando de registrar en el Radar:** conversión siempre junto a registros por cada 10 tickets; si
  caen, la conversión sale "no confiable". La conversión no es meta individual de vendedora.
- **Partir tickets para subir número de ventas:** el candado es ticket promedio; un cliente por día cuenta una vez en
  recompra.
- **Subir el ticket juntando clientes en un ticket:** candado de artículos por ticket y clientes nuevos.
- **Tácticas "probadas" sin haberse hecho:** solo cuentan con evidencia o número; "no se hizo" no cuenta ni a favor ni en
  contra.
- **Cambiar el manual para que algo parezca probado:** el manual guarda historial de cambios con quién y cuándo; la
  etiqueta de prueba no se edita a mano.

## 10. Lo que no entra (por ahora)

- Incentivos o comisiones atados a estos números (decisión aparte de Victor, cuando haya vendedor y costo).
- Bandeja de mensajes en los números (cuando se conecte Meta).
- Metas por vendedor (fase 2).
- Envío de recordatorios automáticos a clientes.

## 11. Orden de construcción (Claude)

0. Colección `mostrador` (4.3): agente, contrato, servidor, respaldo; carga histórica desde 2025-01-01 en Ocosingo.
1. Tablero semanal por tienda (4.1 sin margen) + configuración de categorías instrumento/accesorio.
2. Manual de tácticas con etiquetas e historial, primera versión cargada.
3. Metas que se miden solas (`cinco_caminos:<numero>`) y compromisos del lunes.
4. Planeador en modo cinco caminos + aprobación del gerente.
5. Cierre del mes: evaluación de tácticas y etiquetas; réplica en el diagnóstico.
6. Vendedor (`vnd_id`) y costo desde el agente; números por vendedor y margen.

## 12. Lo que queda al constructor

Nombres de archivos y funciones, cálculo eficiente sobre SQLite, textos exactos de pantalla (en el estilo de las
pantallas SICAR existentes), y la forma exacta del semáforo dentro de lo dicho arriba.
