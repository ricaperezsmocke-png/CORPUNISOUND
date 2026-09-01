# Radar de Demanda — agrupar el mismo producto aunque se escriba distinto

Fecha: 2026-08-31
Estado: diseño aprobado por Victor, pendiente de plan de implementación

## Por qué existe este cambio

El Radar de Demanda existe para una sola cosa: **entender por qué estamos
perdiendo clientes**. Cada registro es un cliente que pidió algo y se fue sin
comprarlo.

Cuando el producto no está en el catálogo, el vendedor lo escribe a mano en
cinco campos libres. Dos vendedores que anotan el mismo producto casi nunca lo
escriben igual. Hoy el sistema los cuenta como productos distintos, y eso rompe
justamente lo que el módulo debía contestar: un producto que diez clientes
pidieron aparece como seis productos con una o dos solicitudes cada uno,
ninguno junta evidencia suficiente, y la compra que sí valía la pena nunca se
hace.

## Estado real al escribir esto

Producción tiene **14 registros**, todos del 25 al 29 de agosto de 2026, todos
de la sucursal 1, todos de texto libre, y **ninguno duplicado**. Se corrió la
regla propuesta contra esos datos con umbrales de 0.3 a 0.85: en todos, 14
renglones antes y 14 después.

Esto se construye como **prevención**, no como corrección de un problema
observable hoy. Quien implemente esto no debe esperar que el antes/después
cambie ningún número en producción. Que no cambie es el resultado correcto.

## Alcance negativo — qué NO se toca

Esta sección es una instrucción directa de Victor y tiene prioridad sobre
cualquier mejora que parezca buena idea durante la implementación.

- **No se da de alta ningún producto.** Este cambio no crea entidades de
  ninguna clase.
- **No se toca el inventario.** Ni existencias, ni movimientos, ni traspasos,
  ni compras.
- **No se toca el catálogo de productos.** Nada de deduplicar, fusionar,
  renombrar, marcar ni sugerir altas de productos del catálogo.
- **La identidad de un producto catalogado sigue siendo exclusivamente
  `producto_id`.** Regla ya congelada en el diseño del Radar; este cambio no la
  toca. Un texto libre nunca se junta con un producto del catálogo, aunque
  coincida palabra por palabra.
- **La pantalla de captura no cambia.** Nada de autocompletado ni sugerencias.
- **No hay migración de datos.** La identidad se calcula al leer; los registros
  guardados no se modifican. Si la regla resulta mala, se cambia la función y
  todo se reagrupa solo.
- **No hay fusión ni separación manual.** Sin botón de "estos dos no son lo
  mismo". Se evalúa después, con datos reales.

En una frase: este cambio solo altera **cómo se cuentan al mostrarlos** unos
registros que ya existen. No escribe nada.

## La regla de identidad

Módulo nuevo: `backend/radar/identidad.js`. Es la **única** definición de
"mismo producto libre" en todo el sistema.

### Paso 1 — bolsa de palabras

De cada registro se toman cuatro campos: `producto_buscado`,
`marca_solicitada`, `modelo_solicitado`, `variante_solicitada`. Se concatenan
en un solo texto (no se comparan campo por campo: quien escribe todo junto en
la descripción y quien lo reparte en Marca y Modelo deben caer en el mismo
grupo).

`categoria_solicitada` **no cuenta para la identidad**. Es una etiqueta de
clasificación, no lo que distingue un producto, y es el campo que más se deja
vacío: si contara, quien la llena y quien no quedarían separados. Se sigue
mostrando como dato del grupo.

Sobre ese texto, en este orden exacto:

1. Minúsculas con `toLocaleLowerCase("es")`.
2. Quitar acentos: `normalize("NFD")` y borrar los diacríticos. Esto convierte
   `ñ` en `n` a propósito ("niño" = "nino").
3. Unificar unidades: comillas de pulgada (`"` y `''`), `pulg` y `pulgada` se
   vuelven `pulgadas`; `m`, `mt` y `mts` se vuelven `metros`; `watt` y `watts`
   se vuelven `w`; `volt` y `volts` se vuelven `v`. Siempre pegados al número
   que los precede.
4. Sustituir por espacio todo lo que no sea letra, dígito, `/` o `.`
   (se conservan `/` y `.` porque `1/4` y `6.3` son medidas reales del negocio).
5. Partir en palabras y quitar las vacías: *de, del, la, el, los, las, un, una,
   unos, unas, para, con, y, o, a, en, por, al*.
6. Quitar plural simple: a las palabras **sin dígitos** de 4 letras o más que
   terminan en `s`, quitarles la `s` final. `bocinas` = `bocina`.
7. Quitar repetidas y ordenar alfabéticamente. Así el orden en que se
   escribieron las palabras deja de importar.

### Paso 2 — comparar dos bolsas

**El candado de números va primero y no tiene excepciones.** Se separan las
palabras que contienen algún dígito. Dos registros solo pueden compararse si su
conjunto de palabras con dígitos es **idéntico**. Si no lo es, la similitud es
0 y se acabó, sin importar cuánto se parezca el resto.

Esto es lo que hace aceptable el parecido difuso: `cable HDMI 2m` y
`cable HDMI 20m` se parecen 0.9 como texto y aun así jamás se juntan, porque
`2` no es `20`. También protege los modelos: `EON615` nunca se confunde con
`EON615S`.

Pasado el candado, las palabras sin dígitos se emparejan una a una. Dos
palabras cuentan como iguales si son idénticas, o si su distancia de edición
(Levenshtein) cabe dentro de la tolerancia que les corresponde. La tolerancia
se decide con la palabra **más larga** de las dos, y cubre todos los largos sin
huecos:

| Largo de la palabra más larga | Tolerancia |
|---|---|
| 4 letras o menos | 0 — solo idénticas |
| de 5 a 7 letras | 1 |
| 8 letras o más | 2 |

Con eso `bosina` cae con `bocina`, y `amolificador` cae con `amplificador` —
esa segunda errata es real, está en el registro #13 de producción. Las palabras
cortas nunca se confunden entre sí: `din` y `dim` siguen siendo distintas, y
`jbl` solo empareja con `jbl`.

La similitud es el coeficiente de Dice sobre las palabras emparejadas:
`2 × emparejadas / (total_A + total_B)`.

### Paso 3 — formar los grupos

El parecido **no es transitivo**: A se parece a B, B se parece a C, y A y C no.
Si se permitiera encadenar, un grupo crecería hasta tragarse cosas que no
tienen nada que ver.

Por eso cada grupo tiene un **texto líder**, y un registro entra al grupo solo
si se parece **al líder**, nunca a otro miembro. Si se parece a varios líderes,
entra al de mayor puntaje; si dos líderes empatan en puntaje, gana el que se
haya creado primero según el orden determinista de abajo.

El resultado no puede depender del orden en que se capturaron los registros.
Antes de agrupar se ordenan de forma determinista: por cuántas veces se repite
su bolsa limpia exacta (de mayor a menor), luego por la bolsa en orden
alfabético, y al final por `id`. Con el mismo conjunto de registros, el mismo
resultado, siempre.

### El umbral

`UMBRAL_PARECIDO = 0.8`, exportado como constante con nombre desde
`identidad.js` para poder moverlo en un solo lugar.

**Este número no está calibrado con datos reales**, porque no hay datos reales
que lo calibren: 14 registros sin un solo duplicado. Sale de casos construidos
a mano, donde 0.8 junta las variantes de escritura y deja fuera lo que debe
quedar fuera. Cuando el Radar acumule un par de meses de uso, hay que volver a
correr el antes/después contra datos de verdad y ajustarlo. Queda anotado como
deuda declarada, no como valor definitivo.

## Dónde se aplica

Las tres agrupaciones que hoy existen se reemplazan por llamadas al módulo
nuevo:

| Lugar | Hoy | Problema que arrastra |
|---|---|---|
| `backend/radarDemanda.js:452` — tabla "Producto" de Análisis | 5 campos, texto exacto | Se parte con cualquier variación |
| `backend/radarDemanda.js:470` — "Productos no manejados" | 4 campos, texto exacto | **Bug: ignora `variante`**, así que agrupa distinto que la tabla de arriba en la misma pantalla |
| `backend/radarDemandaInteligencia.js:139` — Inteligencia de Compras | 5 campos, texto exacto | Es donde se decide la compra; es donde más duele partirse |

En "Productos no manejados" hay además una mezcla que se corrige: hoy usa
`producto_buscado || producto_nombre_registrado`, con lo que un producto
catalogado puede caer ahí agrupado por texto. Con este cambio, los registros
catalogados se agrupan por `producto_id` y los libres por identidad difusa,
nunca mezclados.

## Qué se muestra

- **Nombre del renglón:** la forma más escrita del grupo. Si empatan, la más
  reciente. No el primero que se encontró, como hoy.
- **Columna nueva `formas_distintas`:** cuántas maneras de escribirlo se
  juntaron en ese renglón.
- **Al abrir el detalle:** cada forma escrita, cuántas veces se escribió así, y
  qué tanto se pareció al líder.

Esa transparencia no es adorno. Como el sistema ahora adivina, es la única
manera de que Victor detecte un agrupamiento equivocado en vez de confiar a
ciegas en un número.

## Lo que este cambio NO resuelve

- Dos productos que un humano llamaría iguales pero se describen con palabras
  completamente distintas ("bafle" contra "bocina") **no** se juntan. No hay
  diccionario de sinónimos.
- El candado de números es deliberadamente estricto: `cable de 2 metros` y
  `cable de 2m con conector` se juntan, pero `cable de 2 metros` y
  `cable de dos metros` (el número escrito con letra) no.
- Un agrupamiento equivocado no se puede deshacer desde la interfaz. Se ve, se
  reporta, y se corrige cambiando la regla.

## Pruebas

TDD. Rojo antes que verde, siempre.

**Unitarias de `identidad.js`** — tabla de casos que debe incluir, como mínimo:

- `"Bocina JBL EON615"` cae en el mismo grupo que
  `producto:"bocina" marca:"JBL" modelo:"EON615"`
- `"BOCINAS  JBL  EON615 negra"` cae en ese grupo (palabra de más)
- `"bosina jbl eon615"` cae en ese grupo (errata)
- `"cable HDMI 2m"` y `"Cable HDMI de 2 metros"` caen en el mismo grupo
- **`"cable HDMI 2m"` y `"cable hdmi de 20m"` quedan en grupos distintos, a
  cualquier umbral**
- `"EON615"` y `"EON615S"` quedan en grupos distintos
- Registro con todos los campos vacíos: no produce grupo, no rompe
- El resultado no cambia si se barajan los registros de entrada
- `categoria_solicitada` distinta no separa dos registros por lo demás iguales

**De integración:** `obtenerAnalisis` y `obtenerEvidenciaCompras` devuelven
grupos agregados correctamente, con `formas_distintas` y el nombre líder bien
elegido, y los catalogados siguen agrupándose solo por `producto_id`.

**Regresión:** las suites existentes del Radar quedan verdes
(`radarDemanda*.test.js`, `radarMetricas`, `radarEntrada`, `radarReglasEstado`,
`radarVinculoCrm`). Varias afirman conteos de agrupación y van a necesitar
revisión honesta: si una cambia, hay que entender por qué antes de tocarla.

**Verificación en navegador:** obligatoria, en las pantallas Análisis e
Inteligencia, contra datos de prueba que sí tengan duplicados.

## Riesgos

| Riesgo | Contención |
|---|---|
| Junta dos productos distintos y ensucia la evidencia de compra | Candado de números; líder fijo sin encadenamiento; `formas_distintas` visible para detectarlo |
| El umbral 0.8 resulta malo con datos reales | Constante única en un solo archivo; deuda declarada de recalibrar con datos |
| Costo de cómputo: comparar cada registro contra cada líder | Aceptable a la escala del negocio (miles de registros). Si algún día pesa, se indexa por el conjunto de números o por la primera letra |
| Alguna prueba existente cambia de resultado | Se investiga caso por caso; ninguna se ajusta solo para que pase |
