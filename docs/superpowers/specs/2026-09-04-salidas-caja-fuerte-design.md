# Salidas de la caja fuerte — diseño

**Fecha:** 2026-09-04 · **Decidido con Victor en esa fecha.**
**Sub-proyecto 1 de 3** del módulo del contador. Los otros dos, en orden: el **Tablero de Dinero**
(lectura, `docs/superpowers/plans/2026-09-03-tablero-dinero.md`) y el **traslado de efectivo entre
tiendas** (envío y recepción, como los traspasos de mercancía). Cada uno con su spec y su plan.

---

## El problema, y por qué no puede esperar

En las tiendas de Unisound el efectivo vive en dos sitios: el **cajón** de la cajera, de donde sale
el cambio y que es lo que cuenta el corte, y la **caja fuerte**, donde se resguarda lo que se va
acumulando. De los dos se paga: lo chico y urgente sale del cajón, lo grande o lo planeado sale de
la caja fuerte — nóminas, servicios, compras a proveedores.

El sistema no distingue los dos casos. `gastosEfectivoDelTurnoLista` (`backend/gastos.js`) resta del
cajón **todo** gasto activo en `EFECTIVO` de esa sucursal y esa caja dentro del turno, y no existe
ningún concepto de origen del dinero: ni en `crearGasto`, ni en `depositos.js`, ni en `cortes.js`.
Verificado leyendo el código el 2026-09-03.

Consecuencia, viva hoy: **una nómina pagada desde la caja fuerte y capturada como gasto en efectivo
le resta al cajón de la cajera dinero que nunca salió de ahí, y le inventa un faltante en su corte.**
El defecto es anterior a todo el trabajo de cajas. Es la razón por la que este sub-proyecto va
primero: los otros dos son valor nuevo, este arregla dinero que se está descuadrando ahora.

---

## La decisión de fondo, y por qué cambió

El 2026-09-03 Victor eligió la **opción A**: que una salida de la caja fuerte fuera un concepto
propio, con su pantalla. El 2026-09-04, al preguntarle de dónde sale el billete en la práctica,
respondió que **de los dos sitios según el caso**. Ese dato cambia la conclusión, y por eso el
diseño se movió — no es volver sobre una decisión cerrada, es un hecho nuevo.

Con dos pantallas casi idénticas cuya única diferencia es de dónde salió el dinero, la cajera que
paga la gasolina tiene que acordarse de cuál abrir. Si se equivoca, el descuadre reaparece por el
lado contrario y es más difícil de rastrear, porque el gasto sí existe: está en el lugar equivocado.

**Lo decidido (2026-09-04): una sola puerta de captura.** Gastos sigue siendo la única pantalla, y
el formulario pregunta el origen. Por dentro se conserva lo que la opción A buscaba —la salida de
caja fuerte es un concepto distinto en los datos, que no toca el corte de nadie— pero no existe una
segunda pantalla donde equivocarse.

**Los depósitos se quedan aparte.** Un depósito no es un gasto: el dinero no se gastó, se movió al
banco. Convertirlo en un tipo de gasto ensuciaría el reporte de Utilidad. Solo ganan el campo de
caja, y eso pertenece al sub-proyecto 2.

---

## El modelo: dos datos distintos, dos controles distintos

Un gasto en efectivo responde a dos preguntas que no son la misma:

| Dato | Qué contesta | Quién lo ve |
|---|---|---|
| `caja_id` | **De quién es ese dinero** — Administrativa o Fiscal | Todos los que capturan gastos |
| `origen` | **Dónde estaba** — en el cajón o resguardado | Solo quien tenga el permiso nuevo |

La caja hace falta **siempre**, incluso para lo que sale de la caja fuerte: el resguardo también se
lleva por caja, y sin ese dato el tablero del sub-proyecto 2 no podría dar el desglose
Administrativa/Fiscal y tendría que dar un solo número.

### Campo nuevo

```
gasto.origen: "CAJON" | "CAJA_FUERTE"
```

- **Ausente o `null` = `"CAJON"`.** Todos los gastos ya capturados son del cajón, que es como se han
  venido tratando. La absorción de lo histórico se hace por defecto, sin reescribir un solo
  registro — mismo criterio que usó el módulo de cajas con `caja_id` nulo.
- `"CAJA_FUERTE"` solo puede escribirlo quien tenga el permiso nuevo. El backend lo rechaza si no,
  aunque el valor llegue en la petición a mano.

---

## Las reglas

### R1 — Lo que salió de la caja fuerte no le resta al cajón

`gastosEfectivoDelTurnoLista` gana una condición: **excluye los gastos con `origen === "CAJA_FUERTE"`.**
Ahí termina el cambio de cálculo. El corte, el sellado por `corte_id` y la época sellada no se tocan.

Es una sola condición en un solo lugar, y así tiene que quedarse: en este repo, cada vez que una
regla de dinero ha vivido en dos sitios, los dos han acabado discrepando.

### R2 — El origen solo lo elige quien puede

Permiso nuevo **`registrar_gasto_caja_fuerte`**, módulo `gastos`, registrado en
`backend/permisosCatalogo.js`. Sin él:

- La casilla no se pinta en el formulario.
- El backend rechaza un `origen: "CAJA_FUERTE"` que llegue de todas formas, con un mensaje claro.

**Por qué es un permiso propio y no viene incluido en `registrar_gastos`:** quien marca un gasto como
pagado desde la caja fuerte está bajando el saldo del dinero resguardado **sin que el corte de nadie
se descuadre** — precisamente porque ese gasto no le resta a ninguna cajera. Con un comprobante
falso, es la forma más limpia de sacar dinero del resguardo sin dejar una señal contable. Separar el
permiso cierra ese hueco desde el principio y cuesta una línea. Victor se lo dará a encargados de
tienda, o solo a sí mismo.

### R3 — Un gasto mal capturado se corrige, mientras no se haya cortado

Mismo trato que ya reciben las ventas con `cambiar_caja_venta`: **se puede corregir el origen y la
caja de un gasto mientras no haya entrado en un corte cerrado.** Después no, porque cambiaría un
corte ya firmado.

Requiere `registrar_gasto_caja_fuerte`, y queda constancia en la bitácora del gasto de quién lo movió
y cuándo. Sin esta regla, un gasto marcado mal es un faltante permanente a nombre de alguien.

### R4 — El comprobante sigue siendo obligatorio

No cambia: `crearGasto` ya lo exige y lo sube a Drive. Para una salida de caja fuerte es todavía más
importante, porque es el único rastro físico de que ese dinero salió por algo real.

---

## La pantalla

En `src/Gastos.jsx`, cuando la forma de pago es `EFECTIVO`:

```
¿De qué caja salió el dinero? *
  (•) Caja Administrativa      <- sugerida: la del encabezado
  ( ) Caja Fiscal

  [ ] Salió de la caja fuerte, no del cajón
      ↑ solo se pinta con el permiso registrar_gasto_caja_fuerte

  Este gasto se descontará del efectivo esperado en el corte de la caja Administrativa.
  ↑ el aviso cambia según lo elegido; con la casilla marcada dice que NO le resta a
    ningún corte, y que baja el dinero resguardado de esa caja.
```

Para una cajera sin el permiso, la pantalla es exactamente la del plan de arreglos de cajas: elige
entre sus dos cajas y ya. La casilla no existe para ella.

En la lista de gastos, una columna **Origen** (Cajón / Caja fuerte) y un filtro por origen. Para el
contador, ver las dos cosas juntas es más útil que separadas: es todo dinero que salió.

Cuando la forma de pago no es efectivo, no se pregunta nada de esto: una transferencia o una tarjeta
no tocan ni el cajón ni la caja fuerte.

---

## Fuera de alcance

- **Los traslados de efectivo entre tiendas.** Van en el sub-proyecto 3, con envío y recepción como
  los traspasos de mercancía. Hasta entonces se siguen moviendo fuera del sistema — es preferible a
  que el tablero muestre un número que se ve exacto y está mal, con la tienda que recibe apareciendo
  con menos efectivo del que tiene.
- **El saldo de la caja fuerte.** No se calcula aquí y por lo tanto **no se bloquea una salida mayor
  al resguardo disponible**: todavía no existe quien sepa cuánto hay. Llega con el sub-proyecto 2, y
  ahí se decide si avisar o impedir.
- **Los gastos ya capturados no se reescriben.** Los cortes que hayan quedado con un faltante falso
  se quedan como están; corregirlos hacia atrás cambiaría cortes firmados.
- **Los depósitos**, salvo lo dicho: siguen con su folio y su pantalla, y su `caja_id` es del
  sub-proyecto 2.
- **No se toca el corte, ni el sellado, ni la época.** Están cerrados y probados.

---

## Qué se prueba

| Qué | Cómo se comprueba |
|---|---|
| Un gasto de caja fuerte no le resta al cajón | `gastosEfectivoDelTurno` no lo suma; el calculado del corte no se mueve |
| Un gasto del cajón sí le resta | El caso de siempre, que no se puede romper al agregar el nuevo |
| Un gasto sin `origen` cuenta como del cajón | Todo lo ya capturado se comporta igual que antes |
| El origen respeta la caja | Un gasto de caja fuerte de la Fiscal no aparece en el corte de la Administrativa ni al revés |
| Sin permiso, el backend rechaza | Un `origen: "CAJA_FUERTE"` mandado a mano por quien no puede se rechaza, no se guarda como cajón en silencio |
| La corrección respeta el corte | Corregir un gasto ya sellado se rechaza; uno pendiente se corrige y queda en bitácora |
| El permiso está bien dado de alta | El guard de arranque no se cae y la ruta usa su permiso propio, no uno prestado |

**Y en la tienda, la que de verdad importa:** pagar algo desde la caja fuerte, cerrar el corte de la
cajera, y comprobar que **no se movió ni un peso** de lo que el sistema le pide contar.

---

## Dependencias

Este sub-proyecto se construye **encima del selector de caja del plan de arreglos de cajas**
(`docs/superpowers/plans/2026-09-04-arreglos-revision-cajas.md`, Tareas 4 y 5): ahí el gasto pasa a
declarar su caja en vez de heredarla del encabezado. Este spec agrega la tercera pieza —el origen— al
mismo control.

**Por lo tanto, aquí no se empieza hasta que esas dos tareas estén hechas y revisadas.** La rama
`feature/tablero-dinero` está construida sobre un punto intermedio de `feature/cajas-pos` y le faltan
los últimos commits; ponerla al día es una operación de Victor, y toca antes de escribir código.
