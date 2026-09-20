# Despacho: cerrar los 3 huecos que quedaron en las reglas del Radar

## Coordenadas

- **Worktree (unico lugar donde escribes):** `C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/radar-huecos`
- **Rama:** `feature/radar-huecos`
- **Commit base:** `9d6444b` (master, ya con las reglas nuevas en produccion)
- **Baseline de pruebas:** `1714 pass / 0 fail`
- **Comando (por archivo; NO corras la suite completa, se arrastra desde tu entorno):**
  `node --preserve-symlinks --preserve-symlinks-main --test backend/radar/familias.test.js`

## De donde salen estos tres

Las reglas nuevas ya estan en produccion y bajaron el "Por clasificar" de **70 de 155 (45%) a 16 de
156 (10%)**. De esos 16, **doce esta bien que sigan asi** (codigos de modelo sueltos, descripciones
vagas, y cuatro que antes se contaban MAL y ahora estan visibles a proposito).

**Quedan exactamente tres huecos reales.** Son estos, con su texto tal cual de produccion:

### Hueco 1 — `puas`

Falta la familia. Unisound vende puas de guitarra y no hay regla para ellas.
Cubre el singular y el plural, con y sin acento: `pua`, `puas`, `púa`, `púas`, y la forma que usa
media Mexico, `plumilla` / `plumillas`. Que NO se confunda con nada existente.

### Hueco 2 — `MIRCOROFO STEREN INALAMBRICO`

Es un **microfono** mal escrito. La familia `Microfonos` YA existe y la tolerancia a erratas de
`backend/radar/identidad.js` (`palabrasCompatibles`, distancia de edicion) tampoco lo atrapa.

**Averigua por que antes de tocar nada.** Sospecha a verificar: la distancia de edicion entre
`mircorofo` y `microfono` puede ser mayor que el umbral, porque hay letras transpuestas ademas de
cambiadas. **No subas el umbral a lo bruto:** un umbral mas flojo puede empezar a juntar palabras
que no son lo mismo, y este negocio ya tiene "guitarra" y "guitarron", que NO se pueden confundir.

Si la unica forma de atrapar `mircorofo` es aflojar el umbral al punto de romper
`guitarra`/`guitarron`, **DETENTE y reportalo**: preferimos que quede sin clasificar.

**Pruebas obligatorias de este hueco:** que `mircorofo` caiga en Microfonos, y que `guitarra` y
`guitarron` sigan SIN confundirse entre si. Las dos, en el mismo commit.

Dato extra del mismo texto: `STEREN` ya esta en `MARCAS` e `INALAMBRICO` ya es un tipo de microfono.
Si la familia se reconoce, marca y tipo deberian salir solos: comprueba que asi sea.

### Hueco 3 — `Caña para Clarinete y cuerdas para Viola y Viloncello`

Esta es la delicada. Hoy cae en "Por clasificar" y **antes** caia en Cuerdas.

La causa esta verificada: `articuloPrincipal` hace `break` al encontrar `para`, asi que nunca llega
a la palabra `cuerdas` que viene despues. Ese `break` se puso a proposito y **arregla errores caros
que NO se pueden reintroducir**:

| Texto real | Antes contaba como | Debe seguir asi |
|---|---|---|
| `Aceite para émbolos de trompeta` | Trompetas | NO es una trompeta |
| `GOMAS PARA TECLADO` | Teclados | NO es un teclado |
| `ACCESORIO PARA PEDESTAL` | Bases y atriles | NO es un pedestal |
| `diapason para guitarra` | Guitarras | NO es una guitarra |

Lo que se busca: que el `break` deje de mirar **solo el tramo que describe el destinatario**, y
vuelva a buscar cuando empieza un articulo nuevo de verdad. En `Caña para Clarinete y cuerdas para
Viola`, despues de `y` empieza `cuerdas`, que si es un articulo pedido.

Ya existe logica parecida en `separarArticulos` y `empiezaArticulo`: **reusala en vez de escribir
otra.** Ojo con el comentario que ya esta ahi: «para guitarra y bajo» describe compatibilidad, no una
segunda compra, y eso tiene que seguir funcionando.

**Pruebas obligatorias de este hueco:** los cuatro textos de la tabla siguen SIN contarse como el
instrumento, `Caña para Clarinete y cuerdas para Viola y Viloncello` vuelve a reconocerse, y
`pastilla para guitarra` sigue en Pastillas y `guitarra con pastilla` en Guitarras.

**Si no encuentras una regla general que cumpla las dos cosas, DETENTE y reportalo.** Este hueco es
UN registro de 156 y queda visible en "Por clasificar": dejarlo asi es mucho mejor que volver a
contar aceite como trompetas.

## Archivos autorizados

- `backend/radar/familias.js` y `backend/radar/familias.test.js`
- `backend/radar/identidad.js` y su archivo de pruebas (solo para el hueco 2, y de forma **aditiva**:
  `crearBolsaPalabras` y `agruparRegistrosLibres` conservan su contrato)

**Prohibido** cualquier otro archivo, y en particular `backend/server.js`, `backend/radarDemanda.js`,
`src/`, `render.yaml`, `package.json`, `package-lock.json`.

## Invariantes

- **Ninguna dependencia nueva.**
- Funciones puras: no escriben en `DB`, no mutan lo que reciben.
- Reglas **generales**, nunca excepciones por texto ni por ID.
- El Radar **no toca catalogo, inventario, productos ni altas**.
- Acentos correctos (UTF-8).
- TDD: prueba roja primero, con los textos reales de este documento.

## Git

**NO hagas commit, ni `git add`, ni stash, ni checkout, ni push.** Deja los cambios en el arbol:
Claude revisa, corre la suite completa y commitea.

## Entrega

Por cada hueco: que cambiaste, la prueba con su salida, y **si lo cerraste o te detuviste y por que**.
Detenerse en el hueco 2 o el 3 con una buena razon es una entrega valida y esperada.
