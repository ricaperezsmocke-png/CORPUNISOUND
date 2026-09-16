# Despacho: evitar que el codigo nuevo salga con lineas kilometricas

## Coordenadas

- **Worktree (unico lugar donde escribes):** `C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/lint-lineas`
- **Rama:** `feature/lint-lineas`
- **Commit base:** `d829b06`
- **Linea base medida:** `npx eslint src backend` -> **0 errores, 477 warnings**. Esa base **no se
  puede empeorar en errores**, y el numero de warnings tiene que quedar controlado.

## El problema

De 55,607 lineas de codigo, **2,039 pasan de 120 caracteres, 305 pasan de 200 y 90 pasan de 300**.
La peor mide **2,658 caracteres** (`src/radar-demanda/MisDemandas.jsx`, linea 35: una pantalla
entera en un solo renglon). Y no es deuda vieja: los archivos tocados en los ultimos 60 dias tienen
exactamente la misma proporcion. **Se sigue escribiendo asi hoy.**

Victor no programa y esto le importa porque el codigo apelmazado es donde se esconden los errores
que le cuestan dinero.

## Decision ya tomada — NO la re-discutas

**No se instala Prettier ni ninguna dependencia nueva.** Reformatear 55,607 lineas de un sistema que
cobra dinero real produce un cambio que nadie puede revisar y arruina el historial. Este despacho es
**solo configuracion de lo que ya esta instalado**.

## TRABAJO 1 — reglas de complejidad en el ESLint que YA existe

Archivo: `eslint.config.js`. Hoy solo tiene 4 reglas (`no-undef`, `no-unused-vars`,
`react-hooks/rules-of-hooks`, `react-hooks/exhaustive-deps`) y **cero reglas de estilo**.

Agrega, **como warning y no como error** (no se puede romper la base de 0 errores):

```
complexity: 20
max-lines-per-function: 150
max-depth: 4
max-nested-callbacks: 3
```

Estas cuatro estan medidas: suman **103 avisos** sobre los 477 actuales. Confirma ese numero tu
mismo corriendo eslint, y si te da distinto **dilo**, no lo ajustes en silencio.

**NO agregues `max-len`.** Se midio: a 120 mete 2,031 avisos (cuadruplica el ruido) y a 200 mete 311.
Y sobre todo, `max-len` **no arregla nada**: ESLint no parte lineas, solo las cuenta. El Trabajo 2
ataca eso mejor.

**Trampa verificada que NO debes usar:** `max-len` con `ignoreStrings` baja los avisos a 285 y se ve
precioso, pero perdona la linea completa si contiene cualquier texto entre comillas. Se probo contra
el monstruo de 2,658 caracteres: **produce cero avisos**. Perdona justo lo que hay que cazar.

Entrega de este trabajo: el `eslint.config.js` modificado, la salida real de `npx eslint src backend`
con el conteo nuevo, y **la lista de los archivos y funciones que disparan cada regla** — esa lista
es el mapa de que conviene partir despues.

## TRABAJO 2 — regla de hookify que impida escribir lineas largas

El plugin **hookify ya esta instalado y encendido** en `C:/Users/Victor/.claude/plugins`, pero **no
tiene ni una sola regla configurada**. Es Python puro, no necesita instalar nada, y Python 3.10 esta
disponible en esta maquina.

Las reglas viven en archivos `.claude/hookify.*.local.md` **relativos al directorio de trabajo**.

Escribe la regla en este worktree, en `.claude/hookify.lineas-largas.local.md`:

- **Que bloquee escribir lineas de mas de 200 caracteres** en archivos `.js` y `.jsx` de `src/` y
  `backend/`.
- **Arranca con accion `warn`, no `block`.** Victor quiere ver primero con que frecuencia salta
  antes de que estorbe. El cambio a `block` se decide despues, con datos.
- **Cero ruido sobre el codigo existente:** la regla solo mira el texto que se esta escribiendo.

**Dos trampas verificadas leyendo el codigo del plugin. Respetalas o la regla no sirve:**

1. Si usas el formato simple (campo `pattern:` con `event: file`), hookify deduce que debe mirar el
   campo `new_text`, que **solo cubre la herramienta Edit, no Write**. Un archivo nuevo completo se
   colaria entero. **Usa el formato avanzado con `conditions:` y `field: content`**, que cubre Write,
   Edit y MultiEdit.
2. El motor compila la expresion de forma que el punto **no** cruza saltos de linea, asi que
   `.{200,}` significa literalmente "un renglon de 200 caracteres o mas". Eso es lo que queremos.

**Verifica que funciona antes de entregar**, sin escribir en el repo: lee el codigo del plugin
(`hooks/pretooluse.py`, `core/config_loader.py`, `core/rule_engine.py`) y comprueba que tu archivo
se parsea y que el patron casa contra un texto de prueba **en memoria**. Si no puedes comprobarlo
sin escribir archivos fuera del worktree, **dilo** en vez de afirmar que funciona.

## Archivos autorizados

- `eslint.config.js`
- `.claude/hookify.lineas-largas.local.md` (crear)

**Prohibido** tocar cualquier otro archivo del repo, y **prohibido** modificar nada dentro de
`C:/Users/Victor/.claude/` (la configuracion global de Victor no se toca desde un despacho).

## Invariantes

- **Ninguna dependencia nueva**, ni de produccion ni de desarrollo. No toques `package.json` ni
  `package-lock.json`.
- La base de **0 errores de eslint no se rompe**: todo lo nuevo va como warning.
- No reformatees ni una sola linea de codigo existente. Este despacho es configuracion, no limpieza.

## Git

**NO hagas commit, ni `git add`, ni stash, ni checkout, ni push.** Deja los cambios en el arbol:
Claude revisa y commitea.

## Detente y reporta si

- La regla de hookify necesita algo que no esta instalado.
- El conteo de avisos de eslint te da muy distinto de 103.
- Necesitas tocar un archivo fuera de la lista.

## Entrega

1. `eslint.config.js` con las cuatro reglas, la salida real del comando y el conteo.
2. La lista de archivos/funciones que dispara cada regla nueva.
3. El archivo de hookify, explicado en dos lineas **en lenguaje de negocio**: que bloquea y que no.
4. Como comprobaste que la regla de hookify de verdad casa, o por que no pudiste comprobarlo.
