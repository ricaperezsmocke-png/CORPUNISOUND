# Despacho: ampliar las reglas del Radar con las demandas REALES de Unisound

## Coordenadas

- **Worktree (unico lugar donde escribes):** `C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/radar-reglas`
- **Rama:** `feature/radar-reglas`
- **Commit base:** `d829b06` (master, con el Radar por familias ya mergeado)
- **Baseline de pruebas:** `1628 pass / 0 fail`
- **Comando (obligatorio, por archivo; NO corras la suite completa, se arrastra desde tu entorno):**
  `node --preserve-symlinks --preserve-symlinks-main --test backend/radar/familias.test.js`
  La suite completa la corre Claude.

## Por que existe este despacho

El clasificador (`backend/radar/familias.js`) ya esta en produccion y funciona, pero se midio contra
las **155 demandas reales** del negocio y **el 45% no se reconoce** (70 de 155 caen en "Por
clasificar"), y **153 de 155 no tienen tipo**.

La causa es de diseno, no de codigo: las reglas se escribieron suponiendo que Unisound vende
instrumentos. Vende ademas **audio, percusion y electronica**. Este despacho amplia el vocabulario
con las palabras que de verdad escriben los vendedores.

## Documentos que mandan (leelos)

- Spec: `docs/superpowers/specs/2026-09-15-radar-familias-solo-reglas-design.md`
- Plan: `docs/superpowers/plans/2026-09-15-radar-familias-solo-reglas.md`

Decisiones congeladas que NO se re-discuten: SOLO REGLAS (nadie clasifica a mano, cero overrides
persistidos); el Radar **no toca catalogo, inventario, productos ni altas**; cualquier marca se
conserva tal como la escribio el vendedor; el TIPO es lo minimo que cambia que producto sales a
comprar y lo demas es caracteristica.

## EVIDENCIA REAL — los textos que hoy NO se reconocen

Copiados tal cual de produccion (sin datos de contacto). El numero es cuantas veces aparece.

```
4x ESTEREO            2x estereo sony       1x esterio sony       1x arnes de  esterio
2x DIAFRAGMA          1x DIAFRAGMA MITZU    1x TWEETER            1x SUBWOOFER
1x Woofeer para Auto  1x Columna Activa     1x MINI LINE ARRAY    1x SISTEMA MINI LINE ARRAY
1x COBRA PACK MINI LINEAL                   1x CORNETA PARA BANDA 1x COMBO PARA BAJO
1x SISTEMA DE MONITOREO IN EARS             1x AGUDO              1x bufer
1x unidad 300         1x dbx pa2            1x pro40              1x KSB20
1x TIMBAL             1x tambor escolar     1x TAMBOR REGLAMENTARIO, CORNETA ,ENTORCHADO
1x parche 22 para bobo                      1x PATA PARA BONBO    1x BANCO PARA BATERIA
1x Platillos para bateria                   1x AHOGADOR EN CINTA PARA BATERÍA
1x PANDERO JR 8       1x Guiros chicos y pandero media Luna       1x COQUILLA  7C
1x PILA 9V  NORMAL    1x baterias 9v        1x BATEREIA DE 9V     1x bateria recargable AAA
1x CARGADOR DE PILA DE 9V                   1x fusible de ceramica
1x REGULADOR PARA REFRIGERADOR              1x regulador 5000     1x inversor de corriente
1x no breake          1x CENTRO DE CARGA    1x CHICHARRA          1x LED
1x PISTA LED          1x PROTOBOAR          1x protowar           1x IMANES PARA PROYECTO
1x ACCESORIO DE ELECTRONICA                 1x radios             1x CONTROL
1x Acordeón 34 TECLAS 1x Sintetizador       1x LIQUIDO DE HUMO POR GALON
1x CUADERNILLOS DE NOTAS MUSICALES DE UKULELE
1x maquinariametalico 1x Instrumentos en General                  1x iouoi
```

**Observaciones que salen de estos datos y que el diseno debe respetar:**

1. **La cola es larguisima:** 65 textos DISTINTOS en 70 registros. Casi ninguno se repite. No sirve
   una lista de casos: hacen falta reglas por familia con sus variantes y erratas.
2. **Hay erratas por todos lados:** "esterio", "BATEREIA", "PROTOBOAR", "protowar", "bobo" por
   bombo, "BONBO", "no breake", "Woofeer". Ya existe tolerancia a erratas en `backend/radar/identidad.js`
   (`palabrasCompatibles`, distancia de edicion). **Reusala, no escribas otra.**
3. **"iouoi" no es nada.** Hay basura real. Debe quedar en "Por clasificar" sin romper nada.
4. **"Instrumentos en General" y "ACCESORIO DE ELECTRONICA" tampoco son un producto.** Igual.

## TRABAJO 1 — familias que faltan

Agrega reglas a `REGLAS` en `backend/radar/familias.js` para cubrir, como minimo:

- **Audio:** estereos, diafragmas, woofers, subwoofers, tweeters, columnas activas, line arrays,
  cornetas, combos, monitoreo in-ear, arneses, buffers, unidades.
- **Percusion:** timbales, tambores, parches, bombos, platillos, bancos para bateria, panderos,
  guiros, boquillas/coquillas, ahogadores, entorchados.
- **Energia y electronica:** pilas y baterias (9V, AAA), cargadores, fusibles, reguladores,
  inversores, no break, centros de carga, LED, pistas LED, protoboards, chicharras, imanes.
- **Sueltos:** acordeones, sintetizadores, radios, liquido de humo, cuadernillos/metodos.

**OJO con dos cosas:**
- Ya existen en `REGLAS` varias de estas familias (`Reguladores`, `Inversores`, `No break`,
  `Pistas LED`, `Protoboards`, `Bocinas`) pero **no estan atrapando estos textos**. Averigua por que
  antes de duplicar reglas: puede ser la errata, el plural, o que la palabra va en otra posicion.
- **"bateria" es ambiguo en este negocio:** puede ser el instrumento (banco para bateria, platillos
  para bateria, parche) o la pila (baterias 9v, bateria recargable AAA). Resuelvelo por contexto con
  una regla verificable, y si no se puede decidir, deja "Por clasificar" con su motivo. **NO
  adivines:** meter pilas dentro de instrumentos de percusion le haria comprar mal a Victor.

## TRABAJO 2 — tipos con las palabras del negocio

Los tipos actuales de guitarra (`electroacustica`, `electrica`, `acustica`, `clasica`) casi no
aparecen. Estos son los textos reales de guitarra que hoy quedan **sin tipo**:

```
GUITARRA AZTECA      GUITARRA DOCEROLA    GUITARRA 12 CUERDAS   GUITARRA GEWA
guitarra             GUITARRA Y VIOLIN    guitarra economica    guitarra fender
GUITARRA NORMAL      GUITARRA             diapason para guitarra
GUITARRA INFANTIL    GUITARRA SEVILLANA
```

Reglas para esto:
- **AZTECA, SEVILLANA, GEWA y FENDER son MARCAS**, no tipos. GEWA, Sevillana y Fender ya estan en
  `MARCAS`; verifica por que no se reconocen en estos textos. Azteca hay que agregarla.
- **DOCEROLA y 12 CUERDAS son lo mismo** y ya existe la caracteristica `cuerdas_12`. Que
  "GUITARRA DOCEROLA" y "GUITARRA 12 CUERDAS" caigan en el mismo lugar.
- **INFANTIL es un tipo real** (cambia que guitarra compras). NORMAL y ECONOMICA **no son tipo**:
  son descriptores, ya estan en `DESCRIPTORES` o hay que agregarlos.
- Una guitarra sin mas datos ("guitarra", "GUITARRA") es legitima: familia Guitarras, tipo no
  identificado. Eso NO es un defecto y no debe generar ruido.

## TRABAJO 3 — DEFECTO REAL: "diapason para guitarra" se cuenta como guitarra

**Comprobado con datos reales.** `articuloPrincipal` devuelve la primera familia que encuentra
recorriendo el texto, asi que en `"diapason para guitarra"` encuentra `guitarra` y lo clasifica como
**Guitarras**. Consecuencia para el negocio: una demanda de diapasones se lee como demanda de
guitarras, y Victor compra guitarras.

Ya existe logica de `"para"` en `separarArticulos` (comentario: «para guitarra y bajo» describe
compatibilidad), pero **NO en la deteccion del articulo principal**.

Arreglalo: cuando el texto es `<algo> para <familia>`, lo pedido es `<algo>`, no la familia. Si
`<algo>` no se reconoce, queda "Por clasificar" con motivo, **no** como la familia de la derecha.
Cuida no romper los casos que ya pasan: `"pastilla para guitarra"` debe seguir cayendo en Pastillas,
y `"parche 22 para bobo"` debe caer en Parches, no en Bombos.

## TRABAJO 4 — desglose por motivo de las demandas no concretadas

Requisito del spec que quedo sin implementar. Hoy `obtenerAnalisis` cuenta `motivos` con el motivo
INICIAL de la demanda (`motivo_no_venta`), pero cuando una demanda se cierra como `NO_CONVERTIDA`
el vendedor elige un motivo de cierre (`Cliente compró en otro lugar`, `Precio`, `Tiempo de entrega`,
`No respondió`, `Perdió interés`, `Otro`) que se guarda como comentario en el historial.

Expon ese desglose en la respuesta de `obtenerAnalisis`, separado de `motivos` y sin alterarlo.
Para Victor la diferencia es la que decide una compra: **"compro en otro lugar" significa que le
falto el producto; "precio" significa que lo tenia y no se lo llevaron.**

Si al leer el codigo resulta que el motivo de cierre NO queda guardado de forma recuperable,
**DETENTE y reportalo** en vez de inventar un origen de datos.

## Archivos autorizados

- `backend/radar/familias.js` y `backend/radar/familias.test.js`
- `backend/radar/identidad.js` y su archivo de pruebas (solo si hace falta para las erratas, y de
  forma **aditiva**: `crearBolsaPalabras` conserva su contrato)
- `backend/radarDemanda.js` y `backend/radarFamiliasIntegracion.test.js` (solo para el Trabajo 4)

**Prohibido tocar** cualquier otro archivo, y en particular `backend/server.js`, `src/`,
`backend/ventas.js`, `backend/apartados.js`, `render.yaml`, `package.json`, `package-lock.json`.

## Invariantes

- **Ninguna dependencia nueva.**
- Las funciones son **puras**: no escriben en `DB`, no mutan los registros que reciben.
- Nada de excepciones por ID de demanda ni listas de casos particulares: **reglas generales**.
- Acentos correctos (UTF-8) en codigo y textos visibles.
- TDD: prueba roja primero, con los textos REALES de arriba como casos.
- **Cada familia o tipo nuevo necesita su prueba** usando el texto real que lo motivo.

## Git

**NO hagas commit, ni `git add`, ni stash, ni checkout, ni push.** Desde el worktree el commit falla
por `index.lock`. Deja los cambios en el arbol: Claude revisa, corre la suite completa y commitea.

## Detente y reporta si

- Necesitas un archivo fuera de la lista.
- Una decision de negocio no esta escrita aqui (por ejemplo: como distinguir pila de instrumento si
  las reglas no alcanzan).
- Una prueba existente se pone roja.
- El motivo de cierre del Trabajo 4 no es recuperable.

## Entrega

Por cada trabajo: archivos tocados, reglas agregadas, pruebas escritas con su salida y conteo, y
**cuantos de los textos reales de este documento quedan reconocidos y cuantos siguen sin
clasificar**. Ese ultimo numero es el que le importa a Victor.
