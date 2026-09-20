# Despacho: revision independiente de lo que implemento Claude en radar-familias-v2

## Que es esto

Revision adversarial, **SOLO LECTURA**. No implementes, no arregles, no commitees, no corras
servidores. Tu entrega es un informe.

**Regla del proyecto:** nadie valida su propio trabajo. Las Tasks 1-4 las hizo Codex y **NO son tu
objeto de revision** (ya las reviso Claude). Lo que tienes que revisar es **lo que hizo Claude**.

## Coordenadas

- **Worktree:** `C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/radar-familias-v2`
- **Rama:** `feature/radar-familias-v2`
- **Base:** `master` (`753af75`)

## Commits a revisar (los tres son de Claude)

1. **`850de5e`** — Task 5: integracion en las consultas. Las demandas CANCELADA dejan de contar en
   ranking, no manejados, motivos, sucursales, evolucion y comparaciones. Se agregan `familias` y
   `familias_pendientes` a `/api/radar-demanda/analisis` y `familias` a `/inteligencia`.
2. **`a91627a`** — Task 6: pantalla `src/radar-demanda/FamiliasDemanda.jsx` y su conexion en
   `AnalisisDemanda.jsx` e `InteligenciaCompras.jsx`.
3. **`d677a2f`** — arreglos que salieron al probar en navegador: el sobrante del texto ya no se
   convierte en marca (ahora exige mayuscula inicial), "Clasica" como tipo de guitarra, y una
   correccion de redaccion.

**Contexto, no objeto de revision:** `d7e6441` (Tasks 1-4, de Codex) y `21515bc` (docs). Leelos para
entender, pero no los audites.

## Documentos que mandan

- Spec: `docs/superpowers/specs/2026-09-15-radar-familias-solo-reglas-design.md`
- Plan: `docs/superpowers/plans/2026-09-15-radar-familias-solo-reglas.md`

Las decisiones de Victor estan ahi y **no se discuten**; lo que se revisa es si el codigo las cumple.

## Que busco, en orden de importancia

**1. Que el numero que decide una compra no mienta.** Victor no programa: si una cifra esta inflada
o incompleta, compra mal y pierde dinero. Revisa especificamente:
   - Que una CANCELADA no aporte a NINGUNA cifra de las que orientan compra, por ningun camino que
     se me haya escapado. Busca agregados que sigan usando `registros` en vez de `comerciales` en
     `obtenerAnalisis`.
   - Que `familias` y `familias_pendientes` no se puedan sumar por error, y que la pantalla no los
     mezcle.
   - Que los subtotales cuadren: los tipos y las marcas deben sumar las unidades de su familia, y
     las caracteristicas NO deben sumar al total.
   - Que la comparacion contra el periodo anterior use el mismo universo y el mismo filtro en los
     dos periodos.
   - Si el cambio de `resumen` vs `comerciales` deja alguna pantalla mostrando dos numeros que se
     contradicen entre si (por ejemplo "10 solicitudes" arriba y 9 abajo). Si es asi, dilo: puede
     ser correcto pero confuso, y eso tambien cuesta.

**2. Que no se haya roto nada de lo que ya funcionaba.** `metricas.js`, `identidad.js`,
`radarDemanda.js`, `radarDemandaInteligencia.js` y `server.js` ya estaban en uso. Verifica que los
cambios sean aditivos de verdad y que ningun contrato existente cambiara en silencio.

**3. Que el contrato SOLO REGLAS se sostenga.** Ninguna via —POST, PATCH, GET, la pantalla— debe
permitir clasificar a mano ni persistir una clasificacion. Ninguna consulta debe escribir en la
base, el catalogo, el inventario ni las altas.

**4. El arreglo de la marca por mayuscula (`d677a2f`), con lupa.** Es una heuristica que yo invente
al vuelo y es el punto mas debil del trabajo. Preguntas concretas: ¿que casos reales rompe? ¿que
pasa con marcas que se escriben en minusculas, con nombres de dos palabras, con texto en mayusculas
mezcladas, con acentos? ¿Es defendible o hay que reemplazarla por otra regla? Si crees que esta mal,
dilo claro y propon la alternativa.

**5. Las pruebas.** ¿Prueban lo que dicen probar, o pasarian igual con el codigo roto? Busca
aserciones debiles, fixtures que no representan el caso, y casos del plan que quedaron sin cubrir.

**6. Fechas y alcance.** Fechas de solo dia con `fechaLocal()` de `backend/fechas.js` en
`America/Mexico_City`; Render corre en UTC. Y el alcance por sucursal debe resolverse del token de
quien pregunta, nunca del selector del encabezado.

## Como quiero el informe

Para cada hallazgo:
- **Que esta mal**, con archivo y linea.
- **Como se dispara**: los datos o los pasos concretos que lo provocan.
- **Que se lleva**: que numero sale mal y que decision equivocada provoca.
- **Que tan seguro estas**: si lo comprobaste leyendo el codigo o es sospecha.

Separa **defectos reales** de **mejoras opinables**. Si no encuentras defectos en un punto, dilo
explicitamente en vez de callarlo; necesito saber que lo miraste.

Puedes correr pruebas existentes en modo lectura si te ayudan, **por archivo** y siempre con:
`node --preserve-symlinks --preserve-symlinks-main --test backend/<archivo>.test.js`
**No corras la suite completa** (se arrastra desde tu entorno) y **no modifiques ningun archivo**,
tampoco pruebas.
