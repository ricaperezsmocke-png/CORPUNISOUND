# Entrega: Cinco Caminos P5 (cierre del mes, etiquetas y réplica)

Rama `feature/cinco-caminos-p5`, commit base `a9f7195` (encima de master `45e8f9c`). Contrato:
`docs/superpowers/plans/2026-10-27-cinco-caminos-p5-cierre.md`, Tasks 1 a 5. Hecho en Claude Code en la nube.

## Qué cambia para la tienda (en corto, para Victor)

- Al aprobar el plan del mes, cada táctica que se comprueba con evidencia crea su propia meta "Táctica: …" en la tienda,
  con foto o liga y de 1 a 31 veces en el mes. Las vendedoras la marcan "Hecho" como cualquier meta con prueba, y la
  jefatura puede anular evidencia basura.
- Tres días después de que el mes se puede sellar, el sistema califica solo cada táctica: `probada`, `no funcionó`,
  `no se hizo` o `sin dato`, con su cifra ("Ventas con cliente identificado: 50.0 % → 66.7 % (+33.4 %) contra 8 semanas
  previas"). Nadie puede editarlo: no hay botón ni ruta.
- La IA, al proponer el plan de otra tienda, ve lo probado en las demás tiendas (solo mes y cifras, nunca cuál tienda) y
  se le pide proponerlo primero. El gerente decide.
- En la pantalla del plan del mes ahora se pueden ver los 3 meses anteriores con su "Resultado del mes".

## Commits

| Hash | Mensaje |
| --- | --- |
| `5f22da7` | feat(cinco-caminos): evaluacion de tacticas al cierre del mes |
| `0ac0ac4` | feat(cinco-caminos): tactica por evidencia crea su meta con prueba al aprobar |
| `56ce089` | feat(cinco-caminos): cierre automatico del mes con etiquetas |
| `f5dda9c` | feat(cinco-caminos): el diagnostico propone primero lo probado en otras tiendas |
| `3f8f871` | feat(cinco-caminos): pantalla del cierre del mes |
| (este) | docs(cinco-caminos): entrega P5 |

## Validaciones: línea base y resultado final

Instalación: `npm ci` en la raíz y en `backend/` (sin agregar paquetes). Node v22.22.0. En este entorno no hay
`backend/.env` ni `backend/datos.sqlite`.

**Nota:** con Node 22, `node --test src/` falla al no aceptar un directorio ("Cannot find module …/src"). Se corrió
`node --test "src/**/*.test.js"`, que da las mismas 354 pruebas de la línea base de la máquina de Victor.

| Validación | Línea base (`a9f7195`) | Final (`3f8f871`) |
| --- | --- | --- |
| `cd backend && node --test` | 3433 pruebas: 3426 pass, 5 fail, 2 todo | 3467 pruebas: 3460 pass, 5 fail, 2 todo |
| `node --test "src/**/*.test.js"` | 354 pruebas: 353 pass, 1 fail | 364 pruebas: 363 pass, 1 fail |
| `npx vite build` | (no se corrió antes) | `✓ built in 8.76s` |
| `npx eslint src backend` | 0 errores | 0 errores, 847 warnings (+4 en archivos tocados, ver abajo) |

**Fallas ambientales (las mismas antes y después; ninguna nueva):**

Backend:
1. `not ok 89 - ARRANQUE REAL: en desarrollo SÍ se tolera — se queda vivo, avisando` (arranque real del servidor sin
   `.env`).
2. `buscarClavesSat encuentra resultados por texto en la descripción`
3. `buscarClavesSat con texto vacío devuelve resultados paginados`
4. `buscarClavesSat pagina correctamente (página 2 trae resultados distintos a la 1)`
5. `contarClavesSat devuelve el total de claves cuando la tabla existe`

(2 a 5: el catálogo de Claves SAT vive en `datos.sqlite`, que no existe aquí.) Los dos `TODO` de hueco 2 y hueco 3 son
pruebas detenidas a propósito, no fallas.

`src/`:
1. `HistorialMetas conserva la versión retirada e informa quién, fecha y motivo` (`src/objetivos/eliminarMeta.test.js`):
   compara contra `toLocaleString("es-MX")` sin zona horaria y el contenedor corre en UTC.

**eslint:** los 4 warnings nuevos son `no-unused-vars` de los 4 componentes JSX nuevos (`ResultadoDelMes`,
`TacticaDelPlan`, `SinPlan`, `EvidenciaTactica`); es el mismo falso positivo que ya marca a todos los componentes de
esos archivos (`PlanAprobado`, `Borradores`, `PuntoTactica`…). Los archivos nuevos del backend tienen 0 warnings. La
complejidad de `PlanMes` quedó por debajo del máximo (se extrajo `SinPlan`).

Otras revisiones: ninguna línea agregada pasa de 200 caracteres; 0 mojibake y 0 comillas tipográficas en lo agregado;
cada prueba nueva se vio roja antes de implementar y, además, se mutaron los umbrales (+5 %, -5 %, -30 %, 3 días de
gracia), la anulación de evidencia, el deshacer del todo o nada, la regla de no pisar etiquetas, la de no pisar un mes
más nuevo, el orden y el tope de 3 de la réplica y el filtro de la propia tienda: cada mutación puso la suite en rojo y se
revirtió en el mismo paso.

## Archivos tocados

Nuevos:
- `backend/cincoCaminos/cierreMes.js`: evaluación pura (`evaluarTactica`, `evaluarPlan`, `textoResultado`) y el cierre
  (`cerrarMesesPendientes`, `asegurarCierres`, `diaDeCierre`, `avanceEvidencias`).
- `backend/cincoCaminos/cierreMes.test.js`
- `docs/superpowers/sdd/2026-10-27-cinco-caminos-p5/entrega.md` (este archivo)

Modificados:
- `backend/cincoCaminos/planMes.js`: evidencia al aprobar (`decidirTacticas`, `validarPlanMes`), réplica
  (`manualParaIA`, `INSTRUCCIONES_MES`, cifras permitidas), `verPlanMes` con `evidencias`, `fecha_calificacion` y `cierre`.
- `backend/cincoCaminos/planMesFlujo.test.js`, `backend/cincoCaminos/planMes.test.js`
- `backend/reconciliarRestauracion.js`: `cierres` arranca como arreglo; `cerrarTrasRestaurar`.
- `backend/server.js`: `cicloCierreMes` al arrancar (45 s después) y cada hora con `.unref()`; tras restaurar.
- `src/metas/planMes.js`, `src/metas/planMes.test.js`, `src/metas/PlanMes.jsx`, `src/metas/PlanMesRevision.jsx`.

No se tocaron `render.yaml`, `package.json`, `package-lock.json`, `backend/permisosCatalogo.js`,
`backend/metasCapturas.js` ni `agente-sicar/`. Sin dependencias nuevas. Sin permisos nuevos. Sin rutas nuevas.

## Desviaciones del plan y por qué

1. **Dos pruebas de P4 ajustadas** (el plan dice que pasan "sin tocarse, salvo las nuevas de evidencia"):
   - `planMesFlujo.test.js`, "el gerente cambia camino, tactica y cifra…": cambia a la táctica 3 del manual, que es
     `sistema_y_evidencia`; por la decisión congelada ahora crea su meta de evidencia, y la prueba contaba "1 meta". Se
     cuenta solo las metas de número (`fuente !== 'manual'`). La intención (la cifra cambiada crea UNA meta de número
     con 105.00) no cambia.
   - `planMes.test.js`, "las tacticas de fase 2 y 3 y las retiradas no se envian": fija la lista exacta de campos que
     ve la IA. Se agregó `resultados_otras_tiendas`, que el contrato exige. Sigue siendo lista blanca.
2. **Tras restaurar, el cierre no corre dentro de `reconciliarTrasRestaurar`**, sino en `cerrarTrasRestaurar`
   (mismo archivo), que `server.js` llama cuando `restaurar` termina. Motivo: la reconciliación no tiene SICAR,
   `validarAntesDeRestaurar` la corre sobre una copia, y en el camino con SICAR la foto de SICAR se aplica DESPUÉS de
   reconciliar; cerrar ahí calificaría contra el SICAR viejo. `reconciliarTrasRestaurar` sí deja `cierres` como arreglo.
3. **Base o candado en 0 o negativos → `sin_dato`.** El plan lo dice para la base; también se aplicó al candado,
   porque no se puede medir su caída en porcentaje. Falla cerrando: nunca da `probada` sin poder medir.
4. **"Sin dato" del mismo mes del año anterior es solo `null`.** Si el mismo mes de 2025 vale 0, se queda como base y la
   táctica sale `sin_dato` (regla 6 del contrato). El planeador de P4 sí salta un 0 al promedio de 8; aquí se siguió
   el contrato del cierre al pie de la letra. Si Victor prefiere que un 0 caiga a las 8 semanas, es un cambio de una
   línea en `cifrasDe`.
5. **Por sistema, sin valor del mes = `no_se_hizo`** (reglas 3 y 6 del contrato). La prueba "número null → sin_dato" se
   hizo con una táctica por evidencia ya comprobada. En la etiqueta las dos quedan como `sin_dato`.
6. **Etiqueta de un mes más nuevo no se pisa.** Si por algún motivo un mes viejo se cierra después de uno nuevo (por
   ejemplo, tras restaurar), su `probada`/`no_funciono` no sustituye la etiqueta del mes más nuevo. El cierre sí queda.
   Los meses pendientes se cierran en orden de mes.
7. **El registro del cierre trae `texto`** además de los campos del contrato: es el texto de la etiqueta, y la pantalla
   lo muestra en "Resultado del mes".
8. **`cifrasPermitidas` incluye el valor absoluto** de cada cifra enviada: una caída se cita sin signo ("bajó 2.1 %")
   y sin esto el "por qué" se reemplazaba.
9. **`PlanMesRevision.jsx` no estaba en la lista de archivos del Task 5**, pero la ventana de aprobación vive ahí; ahí
   van "Cómo se comprueba" y "Cuántas veces en el mes".
10. **Selector de mes:** antes solo ofrecía el mes actual y el siguiente; ahora muestra también los 3 anteriores (solo
    para ver; "Proponer plan con IA" y los borradores siguen solo en los dos que se pueden planear). Sin esto el
    "Resultado del mes" no se podía ver nunca.
11. **Avance de evidencia:** "Evidencia: 1 de 3" sale del avance calculado igual que el cierre (capturas no anuladas
    dentro del mes), no de `avanceMeta`, para que lo que ve la tienda sea exactamente lo que se va a calificar.

## Lo que quedó sin hacer

- **Prueba en navegador del Task 5**: no se hizo, por instrucción; le toca a Claude en la máquina de Victor. Se hizo
  solo una prueba de humo local: `PlanMes.jsx` empaquetado con esbuild, API falsa y Chromium a 390 px. Mostró bien el mes
  abierto ("Cómo se comprueba: liga · Evidencia: 1 de 3"), el cerrado (etiquetas, "Se hizo", texto y "Calificado por el
  sistema el 08/10/2026. No se edita a mano."), el terminado sin cerrar ("Se califica el 07/09/2026") y la ventana de
  aprobación, que mandó `{ id: 4, decision: "aceptar", prueba: "liga", veces: 4 }` solo para la táctica por evidencia.
  Tailwind no cargó (sin red en la nube), así que el ajuste a 390 px con estilos queda por revisar en la prueba real.
- Para esa prueba: el cierre corre 45 s después de arrancar y cada hora con la fecha real. Para verlo con un mes ya
  pasado hay que sembrar un `plan_mes` de ese mes (o correr `cerrarMesesPendientes(sqlite, DB, { hoy })` con `hoy` fijo
  desde un script de prueba).
- Fuera de este plan, como dice el contrato: vendedor y costo (P6); margen y descuento promedio (fase 3).

## Correcciones de la revisión

Revisión: `origin/revision/cinco-caminos-p5` (`a4f833e`), `docs/revisiones/2026-10-27-cinco-caminos-p5.md`. Base de las
correcciones: `5f34b0c`. Se corrigieron H1, H2 (opción a, que cierra también H5), H3, H6, H4 y H8. **No se tocaron H7
(decisión de Victor), H9 ni H10.** Cada prueba nueva se vio ROJA antes del arreglo; no quedó ninguna mutación.

### En corto, para Victor

- **Editar el manual o la meta de foto después de aprobar ya no cambia la calificación.** Al aprobar, el plan guarda
  cómo se mide cada táctica, su número, su candado, la prueba y cuántas veces se pidió. El cierre califica con eso.
- **Solo cuentan las capturas con foto o liga**, una por captura. Una captura sin prueba no vale nada, aunque diga "31".
- **Si SICAR de una tienda no ha mandado todo el mes, esa tienda no se cierra**; se intenta otra vez cada hora.
- La base de conversión ya no usa semanas que el propio sistema marca como no confiables.
- El texto ya no dice "+5.0 %" en una táctica que no funcionó: dice "+4.9 %".
- En los días de gracia la tienda sigue viendo "Evidencia: x de y".

### Commits

1. `4fdca4c` fix(cinco-caminos): el cierre califica la tactica tal como se aprobo (H1)
2. `1b674fe` fix(cinco-caminos): la evidencia se califica como se aprobo y solo con prueba (H2 y H5)
3. `d88f3b4` fix(cinco-caminos): no cerrar el mes si SICAR no ha mandado todo (H3)
4. `74d3e3e` fix(cinco-caminos): base de conversion sin semanas no confiables (H6)
5. `1f8ab5d` fix(cinco-caminos): texto del cierre coherente con la decision y avance visible en la gracia (H4 y H8)

### Validaciones (texto de la salida)

- `cd backend && node --test`: `# tests 3479`, `# pass 3472`, `# fail 5`, `# todo 2`. Las 5 fallas son las ambientales
  conocidas: `ARRANQUE REAL: en desarrollo SÍ se tolera — se queda vivo, avisando` y las 4 de ClavesSat
  (`buscarClavesSat` ×3, `contarClavesSat`). Ninguna otra.
- `node --test "src/**/*.test.js"`: `# tests 365`, `# pass 364`, `# fail 1`. La falla es la ambiental conocida:
  `HistorialMetas conserva la versión retirada e informa quién, fecha y motivo`.
- `npx vite build`: `✓ built in 13.05s` (solo el aviso de siempre del tamaño de los chunks).
- `npx eslint src backend`: `✖ 847 problems (0 errors, 847 warnings)`. 0 errores; los avisos de los archivos tocados
  son los de antes (variables de JSX "sin usar" en `PlanMes.jsx` y el largo de `registrarRutasCincoCaminos`).
- Ninguna línea de los `.js`/`.jsx` tocados pasa de 200 caracteres; sin mojibake en el diff.

### `cierreMes.revision.js` contra el código corregido

`node --test docs/revisiones/2026-10-27-cinco-caminos-p5/cierreMes.revision.js` (copiado de la rama de revisión, sin
modificar): **`# pass 0`, `# fail 7`**. Las siete (H1a, H1b, H2a, H2b, H3, H4, H5) fallan, como se pidió.

Ojo con la causa: H1a, H1b y H2a fallan antes de llegar a su aserción (`Cannot read properties of undefined (reading
'tacticas')`), porque su arreglo inserta la tienda en `sicar_tiendas` sin `ultima_recepcion` y el arreglo de H3 ya no
cierra esa tienda. Para saber si el defecto de verdad desapareció, se corrieron dos variantes temporales (no se guardaron):

- **Variante A** (misma prueba, SICAR al día): H1a y H1b **pasan** (el defecto sigue), H2a, H2b, H3, H4 y H5 fallan.
  Es lo esperado: los planes de la revisión tienen la forma vieja, sin snapshot, y para esos la instrucción fue usar el
  manual. Ver desviación 2.
- **Variante B** (SICAR al día y el plan con los campos que ahora guarda `validarPlanMes`): **las 7 fallan** con la
  aserción del defecto: H1a `expected 'probada', actual 'no_se_hizo'`; H1b `expected 'clientes_nuevos', actual
  'pct_con_cliente'`; H2a evidencia con `requeridas: 4` y ninguna captura contada; H2b `actual 'no_se_hizo'`; H3
  `expected 1, actual 0` cierres; H4 `expected 5, actual 4.9`; H5 `expected 3, actual 0`.

### Desviaciones y cosas que decidir

1. **Nombre del snapshot:** `plan_mes.tacticas_aprobadas: [{ id, como_se_mide, numero_que_mueve, candado }]`. `tacticas`
   sigue siendo la lista de ids para no romper a quien la lee. `verPlanMes` también toma `como_se_mide` del snapshot.
   Si una táctica del plan no aparece en el snapshot, el cierre de esa tienda truena y se reintenta (falla cerrando).
2. **Planes viejos siguen expuestos a H1.** Un plan aprobado antes de este arreglo no tiene snapshot y se califica con
   el manual vivo (así se pidió). Si en producción ya hay planes del mes aprobados con P4, editar sus tácticas antes de
   su cierre todavía cambia la calificación. Opción: no editar el manual hasta que cierren esos meses.
3. **Evidencia:** `plan.evidencias` guarda `{ tactica_id, meta_clave, prueba, requeridas }`. "Con evidencia" quiere decir
   que la captura trae un objeto `evidencia`; no se compara su tipo (foto o liga) contra la prueba aprobada. Plan viejo:
   `requeridas` y `prueba` de la versión 1 de la meta.
4. **SICAR:** la última recepción se pasa a día de México y debe ser del lunes siguiente al último domingo del mes o
   después. Una tienda sin fila en `sicar_tiendas` (por ejemplo, sin agente) nunca se cierra. La tienda que se salta no
   escribe aviso en el log: el ciclo corre cada hora y llenaría el log; el plan simplemente sigue en "Se califica el …".
5. **Porcentaje:** también el `cambio_pct` y el `candado_cambio_pct` guardados en el cierre van truncados (son las cifras
   que ve la IA), no solo el texto. Cuando el candado cayó y truncado quedaría justo en el umbral, va en centésimas por
   arriba del umbral (−5.04 % → "cayó −5.04 %"; −5.0001 % → "−5.01 %"; igual con el −30 % del Radar). Una prueba vieja
   cambió por esto: "+11.2 %" ahora es "+11.1 %" (11.17 % truncado).
6. **H6 solo en el cierre.** La base de conversión del planeador de P4 (`tablero.promedio_8`) no se tocó, así que cuando
   hay semanas no confiables la base con la que el planeador fijó la meta y la del cierre pueden ser distintas.
7. **H8:** la regla vive en `avanceVisible(plan)` de `src/metas/planMes.js` (con prueba); `PlanMes.jsx` solo la usa.
8. **Pruebas existentes ajustadas** (sin cambiar su intención): las capturas de los arreglos ahora traen `evidencia` y
   la tienda sembrada trae `ultima_recepcion` al día; la prueba de aprobación espera también `prueba` y `requeridas`.
9. **Prueba en navegador:** no se hizo. Sigue pendiente.
