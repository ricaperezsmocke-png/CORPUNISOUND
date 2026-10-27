# Revisión independiente — Cinco Caminos P5 (cierre del mes)

Rama revisada: `feature/cinco-caminos-p5` (`5f34b0c`), diff `a9f7195..5f34b0c`, 6 commits. Revisor: Claude (no escribió
este código). Contrato: `docs/superpowers/plans/2026-10-27-cinco-caminos-p5-cierre.md`; spec 2026-10-24 §5, §6.5, §6.6, §9.

## Veredicto

**No está listo para merge.** Hay tres arreglos acotados que hacer antes: H1, H2 y H3. Por dos caminos, una táctica que nadie
hizo puede salir `probada`. Además, el cierre puede quedar congelado con datos de SICAR incompletos. El resto está bien hecho
y bien probado.

## En corto, para Victor

- **Una táctica puede salir "probada" sin haberse hecho.** Pasa si, después de aprobar el plan, alguien edita la táctica en el
  manual o la meta de foto que se creó para comprobarla. El sistema califica con lo que diga la táctica el día del cierre, no
  con lo que se aprobó. Basta bajar "4 fotos" a "1", o quitarle la foto a la meta, o cambiar la táctica de "por evidencia" a
  "por sistema". No hace falta ningún permiso raro: alcanzan los permisos de siempre para administrar metas y el manual.
- **El cierre no revisa si SICAR ya mandó todo el mes.** Si el agente de una tienda se atrasa, el mes se califica con las
  ventas que haya, y esa calificación ya no se corrige nunca.
- Lo demás funciona como se pidió:
  - los umbrales (+5 %, -5 %, -30 %, 3 días de gracia);
  - que no haya botón ni ruta para cambiar etiquetas;
  - que a la IA no le llegue el nombre de otra tienda;
  - que correrlo dos veces no duplique nada.

## Cómo se verificó

- `cd backend && node --test`: 3467 pruebas, 3460 pasan y 5 fallan, 2 todo. Las 5 fallas son las ambientales conocidas:
  ARRANQUE REAL sin `.env` y las 4 de `buscarClavesSat`/`contarClavesSat`. No hay ninguna falla nueva.
- `node --test backend/cincoCaminos/*.test.js`: 174 de 174. Nota: `node --test cincoCaminos/` (con directorio) **no funciona
  en Node 22**: corre 0 pruebas y da "1 fail". Hay que pasar el glob.
- `node --test "src/**/*.test.js"`: 363 pasan y 1 falla. Es la conocida de `eliminarMeta.test.js` (zona horaria), la misma
  que reporta la entrega.
- `npx eslint src backend`: 0 errores.
- Ninguna línea agregada en `.js` ni `.jsx` pasa de 200 caracteres.
- Pruebas de revisión: `docs/revisiones/2026-10-27-cinco-caminos-p5/cierreMes.revision.js`. Se corren con
  `node --test docs/revisiones/2026-10-27-cinco-caminos-p5/cierreMes.revision.js` y dan 7 de 7. Cada prueba que **pasa**
  demuestra que el defecto existe. No forman parte de la suite y no se tocó código de la rama.
- No se hizo prueba en navegador. La entrega dice que tampoco se hizo y que sigue pendiente.

---

## Hallazgos (de más a menos grave)

### H1 — ALTA — REPRODUCIDO: el cierre califica con la definición actual de la táctica, no con la aprobada

- **Dónde:**
  - `backend/cincoCaminos/cierreMes.js:209-215`: `calificarPlan` lee `como_se_mide`, `numero_que_mueve` y `candado` de
    `tacticaDelManual(DB, id)`, es decir, del manual vivo.
  - `backend/cincoCaminos/planMes.js:426-427`: el `plan_mes` guarda solo los ids de las tácticas.
  - `backend/cincoCaminos/manual.js:174-195` y `rutas.js:147`: `cambiarTactica` (permiso `administrar_manual_tacticas`)
    puede cambiar esos tres campos en cualquier momento.
- **Escenario** (prueba `H1a`):
  1. La tienda 1 aprueba en septiembre la táctica 4 (por evidencia, 3 fotos) y no sube ninguna foto. Sin cambios, el cierre
     da `no_se_hizo`.
  2. Antes del cierre alguien edita la táctica 4: `como_se_mide: 'sistema'`, `numero_que_mueve: 'pct_con_cliente'`,
     `candado: null`.
  3. El cierre da **`probada`**, escribe esa etiqueta y la cuenta en `probada_en`.
  4. Desde ese momento la IA la ofrece a las demás tiendas como probada.
- **Edición legítima:** el defecto también aparece sin mala fe (prueba `H1b`). Cambiar el número o el candado de una táctica
  para corregir el manual vuelve a calificar, en silencio, todos los planes abiertos de todas las tiendas.
- **Lo que dice el spec:** §9 acepta "Cambiar el manual para que algo parezca probado" porque el manual guarda historial. Pero
  nada liga ese historial con el cierre, y la etiqueta resultante no se puede corregir, justo porque "no se edita a mano".
- **Cómo se cierra:**
  - Al aprobar (`validarPlanMes`), copiar en el `plan_mes` un snapshot por táctica: `{ id, como_se_mide, numero_que_mueve,
    candado }`.
  - Que el cierre lea ese snapshot, y el manual solo en los planes viejos que no lo traen.
  - Agregar una prueba que edite la táctica entre aprobar y cerrar y exija el mismo resultado.

### H2 — ALTA — REPRODUCIDO: la meta de evidencia se puede editar después de aprobar y el cierre usa la última versión

- **Dónde:**
  - `backend/cincoCaminos/cierreMes.js:185-187`: `requeridas` sale de `ultima.valor_meta`, la versión más nueva de la meta.
  - `cierreMes.js:40-41`: se suma `cantidad` de cualquier captura no anulada, tenga o no foto.
  - `backend/metasPersonalizadas.js:189-207` y `metasRutas.js:143`: `editarMeta` (permiso
    `administrar_metas_personalizadas`) deja cambiar `valor_meta` y `prueba` mientras el mes no esté sellado.
  - `metasCapturas.js:53-61`: con `prueba: 'ninguna'`, una captura vale de 1 a 1000 y no lleva foto.
- **Escenario A** (prueba `H2a`): el gerente aprueba "4 fotos en el mes". Se sube 1 foto y alguien edita la meta a
  `valor_meta: 1`. El cierre registra `requeridas: 1`, la táctica cuenta como **hecha** y, si su número subió, sale `probada`.
- **Escenario B** (prueba `H2b`): se edita la meta a `prueba: 'ninguna'`. Una sola captura con `cantidad: 31` y sin foto
  cumple "31 veces".
- **Contrato:** esto choca con la regla 2 del Review Focus del plan, "la evidencia exige capturas no anuladas dentro del mes".
  En el escenario B no hay ninguna evidencia.
- **Cómo se cierra.** Cualquiera de las dos opciones:
  - (a) guardar `{ prueba, requeridas }` en `plan.evidencias` al aprobar; que el cierre use esos valores y cuente solo
    capturas con `evidencia` no nula, 1 por captura;
  - (b) que `editarMeta` y `retirarMeta` rechacen las metas con `origen.tipo === 'plan_mes'` y `fuente: 'manual'`.

  (a) es más robusto porque además cubre los respaldos viejos.

### H3 — MEDIA-ALTA — REPRODUCIDO: el mes se cierra aunque SICAR no haya mandado todas sus ventas, y no se recalcula nunca

- **Dónde:**
  - `backend/cincoCaminos/cierreMes.js:253-254`: la única guarda es `if (!sqlite)`.
  - `backend/server.js:134-137`: `conexionSqlite` es la conexión de persistencia, que en producción siempre existe. Por eso la
    regla 10 del contrato ("sin SICAR no se cierra") no se dispara nunca en la práctica.
  - `sicar_tiendas.ultima_recepcion` (`sicarRepositorio.js:19`) existe y no se consulta.
- **Escenario** (prueba `H3`):
  1. El agente SICAR de la tienda deja de enviar el 26 de septiembre (`ultima_recepcion` del 25).
  2. El 8 de octubre el cierre corre igual.
  3. "Clientes nuevos por semana" sale 27 en lugar de 30 (-10 %). La última semana se descarta por pocas ventas y la
     penúltima queda partida.
  4. Cuando el agente se pone al día, la siguiente vuelta no hace nada, porque un cierre nunca se recalcula.
  5. Una táctica que en realidad no movió su número queda `no_funciono` contra un dato falso. En otro caso, un candado que
     "cae" por datos faltantes castiga a la tienda.
- **Cómo se cierra:**
  - No cerrar la tienda mientras `ultima_recepcion` sea anterior al día siguiente al último domingo del mes
    (`primerDiaParaSellar`). Se reintenta en la siguiente vuelta, igual que "sin SICAR".
  - Agregar una prueba con la recepción atrasada.

### H4 — BAJA — REPRODUCIDO: el texto puede decir "+5.0 %" en una táctica que sale "No funcionó"

- **Dónde:** `cierreMes.js:34-35` redondea `cambio_pct` a una décima para el texto, y `cierreMes.js:66` decide con enteros
  exactos.
- **Escenario** (prueba `H4`): base $100.00 y valor $104.96, es decir +4.96 %. Resultado `no_funciono`, pero el texto dice
  "(+5.0 %)". Pasa lo mismo con el candado en -5.04 %: el texto dice "cayó -5.0 %" y el umbral es "más de 5 %". Una
  encargada que lea "+5.0 %" y "No funcionó" va a pensar que el sistema está mal.
- **Cómo se cierra:** truncar hacia cero en lugar de redondear (+4.9 %), o escribir dos decimales cerca del umbral.

### H5 — BAJA — REPRODUCIDO: "Evidencia: x de y" en pantalla y el texto del cierre cuentan distinto

- **Dónde:** la pantalla usa `cierreMes.js:196` (`hechas = suma` de cantidades), y el texto `no_se_hizo` usa
  `cierreMes.js:78` (`capturas_contadas.length`).
- **Escenario** (prueba `H5`): solo aparece si la meta perdió la foto (H2-B). Una captura con cantidad 3 sale en pantalla como
  "3 de 4" y en el cierre como "evidencia 1 de 4". Con foto, cada captura vale 1 y los dos números coinciden: la pregunta 9 se
  cumple en el caso normal. Si se arregla H2 con la opción (a), H5 desaparece.

### H6 — MEDIA — SOLO LEÍDO: la base de conversión incluye semanas "no confiables" y el valor del mes no

- **Dónde:**
  - El valor del mes viene de `metaNumero.js:54` (`conBaseRadar: true` para conversión) con el lector de
    `metaNumero.js:22`: una semana `no_confiable` da `null` y se salta.
  - La base viene de `tablero.js:254`: `promedio_8` arma sus semanas con `semana(l, false)`, así que `no_confiable` queda
    `null` y la conversión de esas semanas **sí** entra al promedio.
- **Escenario:** en las 8 semanas previas la tienda dejó de registrar en el Radar. Su conversión se infla (justo el abuso que
  describe §9) y eso infla la base. En el mes del plan registra bien, la conversión real no llega a +5 % contra esa base
  inflada, y la táctica sale `no_funciono`. Es decir, se castiga a la tienda con un dato que el propio sistema marca como no
  confiable.
- **Atenuante:** el planeador de P4 usa la misma base para fijar la meta, así que el cierre es coherente con la meta.
- **Cómo se cierra:** calcular la base de conversión con `conBaseRadar: true` y saltar las semanas `no_confiable`, igual que el
  valor.

### H7 — MEDIA (decisión de Victor, no defecto de código) — SOLO LEÍDO: una táctica de conversión no puede mover la conversión de su propio mes

- **Dónde:** `tablero.js:113-117`. La conversión de una semana se mide sobre los registros del Radar de 30 a 60 días antes de
  su domingo.
- **Consecuencia:** la "conversión de octubre" es la de los prospectos de agosto y septiembre. Una táctica de conversión que
  se hace en octubre se califica con lo que se hizo antes, y su efecto real cae en la calificación de noviembre o diciembre,
  que es de otra táctica.
- **Lo que hay que decidir:** el contrato no lo contempla. Hay que decidir si las tácticas de conversión (manual 10 a 12) se
  califican con desfase o sin calificación automática.

### H8 — BAJA — SOLO LEÍDO: durante los 3 días de gracia la pantalla esconde el avance de evidencia

- **Dónde:** `src/metas/PlanMes.jsx:64,80`: `abierto={!plan.cierre && !terminado}` y `mesTerminado` es "ya cambió el mes".
- **Escenario:** del 1 al 4 de noviembre todavía se pueden subir fotos con fecha de octubre (`metasCapturas.js:133-135`) y la
  jefatura puede anular. El cierre las cuenta, pero la tienda ya no ve "Evidencia: 2 de 3" y no sabe que le falta una.
- **Cómo se cierra:** mostrar el avance hasta que exista el cierre.

### H9 — BAJA — SOLO LEÍDO: `cifrasPermitidas` acepta el valor absoluto de cualquier cifra

- **Dónde:** `planMes.js:133-134`.
- **Escenario:** a la IA le llega `candado_cambio_pct: -2.1` y puede escribir "su candado subió 2.1 %" sin que la guarda
  reemplace el texto. El signo deja de estar protegido.
- **Cómo se cierra:** aceptarlo así (es un "por qué" informativo) o exigir que el valor absoluto vaya pegado a "bajó" o
  "cayó".

### H10 — INFORMATIVO — desviación del plan que falla cerrando

- `planMes.js:356`: `leerEvidencia(d)` se valida también para las tácticas `sistema`. Una táctica por sistema con
  `prueba: 'video'` da 400, cuando el plan dice "se ignora". Falla cerrando y la pantalla no manda `prueba` para esas
  tácticas. No hay que hacer nada; queda anotado.

---

## Respuestas a las preguntas del Review Focus

1. **¿Alguien puede escribir una etiqueta fuera del cierre?** Directamente, no. `fijarEtiqueta` solo se llama desde
   `cierreMes.js:226` y desde las pruebas, no hay ruta nueva y `cambiarTactica` no acepta `etiquetas`
   (`manual.js:21`, `CAMPOS`). **Indirectamente, sí:** con H1 y H2 se controla qué etiqueta escribe el cierre.
2. **¿Puede salir `probada` sin haberse hecho?** Por la vía normal, no:
   - las capturas anuladas, las de fuera del mes y las de otra meta (`meta_clave` estricto) no cuentan;
   - una meta retirada sin capturas da `no_se_hizo`;
   - una meta de otra tienda no puede quedar ligada, porque `evidencias` lo escribe solo el servidor.

   **Por edición posterior, sí** (H1, H2).
   Observación de diseño: en una táctica `sistema`, "se hizo" equivale a "hay dato". Eso es contrato (regla 3), pero
   significa que una táctica por sistema sale `probada` si el número sube por cualquier causa.
3. **Umbrales.** Son exactos y se comparan en enteros:
   - +5.0 % entra, y -5.0 % y -30.0 % no cuentan como caída;
   - la gracia es `primerDiaParaSellar + 3`;
   - con base o candado en 0, `null` o negativo, la táctica sale `sin_dato`;
   - la conversión no confiable del mes da `null`.

   Las pruebas de la rama cubren los bordes. Hay dos salvedades: el texto (H4) y la base de conversión (H6).
4. **Idempotencia y todo o nada.** Están bien:
   - se arma un cierre por `(sucursal_id, mes)`;
   - la lista de pendientes se calcula una sola vez y puede haber a lo más un `plan_mes` por tienda y mes
     (`planMes.js:392`);
   - los meses se cierran en orden;
   - las etiquetas se deshacen en el mismo objeto (`fijarEtiqueta` modifica en sitio, `manual.js:234-236`);
   - una tienda que truena no frena a las demás;
   - al restaurar, `cierres` arranca como arreglo y el cierre corre después, con SICAR ya restaurado.

   La salvedad es H3: "idempotente" también quiere decir que un cierre con datos malos no se corrige.
5. **¿A la IA le llega id o nombre de otra tienda?** No. `resultados_otras_tiendas` lleva solo
   `{ mes, numero, cambio_pct, candado_cambio_pct }`, `sucursal` es `Number`, la propia tienda se excluye
   (`planMes.js:76`) y el texto de la etiqueta propia pasa por `quitarNombres`.
6. **¿P4 y el planeador viejo siguen igual?** Sí. Las dos pruebas ajustadas conservan su intención:
   - una sigue exigiendo exactamente una meta de número con 105.00;
   - la otra sigue siendo una lista blanca de campos, con un campo más.

   La primera se debilitó un poco: ya no comprueba cuántas metas de evidencia se crearon. No hace falta corregirlo.
7. **Aprobar.** Funciona como se pidió:
   - la meta de evidencia y el plan son todo o nada (`planMes.js:408-433`), porque `crearMeta` solo agrega a
     `metas_personalizadas` y en un error se recorta;
   - `veces` en 0, 32, 1.5 o `"4"` (texto) y una `prueba` inválida se rechazan en el servidor con 400;
   - los ids de táctica se normalizan con `normalizarId`.

   El hueco está después de aprobar (H2).
8. **El ciclo en `server.js`.** Funciona como se pidió:
   - guarda con `guardar(DB)` solo si cerró algo;
   - es síncrono (better-sqlite3), así que no puede correr dos veces a la vez;
   - no corre durante una restauración;
   - tiene `.unref()`.

   Lo que no cumple: "sin SICAR" en la práctica nunca pasa (H3).
9. **"Evidencia: x de y".** Coincide con lo que califica el cierre en el caso normal: misma función y mismo filtro. Las
   salvedades son H5 y H8.

## Lo revisado que está bien

- Toda la calificación vive en el servidor. La pantalla solo pinta el cierre, y no hay ruta para cerrar, reabrir ni editar.
- `ESTADOS_ETIQUETA` no se tocó. `no_se_hizo` se guarda como `sin_dato` y no pisa un `probada` ni un `no_funciono`, y un mes
  viejo no pisa la etiqueta de un mes más nuevo.
- El texto del resultado no lleva nombres, mide 300 caracteres o menos y usa `formatearValor`.
- El cierre aguanta tácticas retiradas: busca por id aunque la táctica esté inactiva.
- Sin dependencias nuevas, sin tocar `render.yaml` ni `permisosCatalogo.js`, y sin líneas de más de 200 caracteres.
- La entrega describe con honestidad sus 11 desviaciones. Las verifiqué y son ciertas; la 4 (un 0 del año anterior queda como
  base) es una decisión que conviene que tome Victor.
