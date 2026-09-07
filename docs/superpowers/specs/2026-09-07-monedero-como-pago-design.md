# El monedero se puede gastar — diseño

**Fecha:** 2026-09-07 · **Decidido con Victor ese día.**

## El problema

Cuando se cancela un apartado, el anticipo que el cliente ya había pagado se convierte en
`cliente.monedero` (`backend/apartados.js:259`). Ese saldo **existe, se muestra en el punto de venta**
(`src/PuntoDeVenta.jsx:868`, "Monedero: $120.00") **y no se puede gastar en ninguna parte.**

Para el cliente es peor que no tenerlo: ve un saldo a su favor que nadie puede aplicarle. Para la
tienda es una deuda invisible que no aparece en ningún reporte.

Victor decidió el 2026-09-07 que **debe poder usarse como forma de pago**.

## La decisión de diseño que define el alcance

El sistema **no tiene pago mixto**: `venta.metodo_pago` es un solo valor. Así que hay dos caminos:

- **Monedero como una forma de pago más.** Simple, pero solo sirve si el saldo cubre la venta
  entera. Un cliente con $120 de monedero no podría usarlo en una compra de $500 — que es
  justamente el caso normal.
- **Monedero como un importe que se aplica ANTES de la forma de pago** (lo elegido). La venta lleva
  `monedero_aplicado`, se descuenta del total, y el resto se cobra por la forma de pago declarada.
  Cubre los dos casos —parcial y total— sin construir un sistema de pagos mixtos.

Se elige el segundo. No es un pago: es un **descuento contra un saldo a favor** que ya existía.

## Las reglas

**R1 — El servidor decide cuánto se aplica.** Igual que con el precio: lo que manda el navegador es
una propuesta. El servidor toma el menor entre lo pedido, el saldo del cliente y el total de la
venta. Nunca confía en la cifra que llega.

**R2 — Solo un cliente real.** "Público en General" (id 0) no tiene monedero y no puede recibir uno.
Se rechaza.

**R3 — EL MONEDERO NO ES EFECTIVO Y NO SUMA AL CAJÓN.** Esta es la regla que más importa. Cuando un
cliente paga $120 con su monedero, **no entra un peso al cajón de la cajera**: se está saldando una
deuda que la tienda ya tenía con él. El corte solo cuenta el resto, por la forma de pago declarada.

Si esto se hiciera mal —sumando el monedero al efectivo esperado— la cajera terminaría el día con un
faltante exactamente igual a todo el monedero aplicado. Es el mismo error que ya nos costó el
descuento por forma de pago.

El monedero aplicado se reporta en su propia cifra del corte, informativa, junto a las que ya
existen para transferencias y crédito.

**R4 — El saldo baja al aplicarse, y vuelve si se cancela.** Cancelar una venta que usó monedero le
devuelve al cliente lo que se le aplicó. Si no, cancelar le robaría el saldo.

**R5 — Queda escrito en la venta.** `venta.monedero_aplicado` guarda el importe. Es el único rastro
de por qué esa venta cobró menos de lo que suman sus líneas, y sin él un descuadre aparente no se
podría explicar.

**R6 — Una venta pagada por completo con monedero sigue siendo una venta.** Total cobrado $0 en su
forma de pago, mercancía descontada del inventario, y entra en el corte sin sumar efectivo.

## Lo que NO entra

- **Pago mixto de verdad** (parte efectivo, parte tarjeta). Es otro proyecto.
- **Cargar saldo al monedero a mano.** Hoy solo nace de un apartado cancelado, y así se queda: dejar
  que alguien escriba saldo a favor sin origen sería crear dinero de la nada.
- **Monedero en apartados.** Solo en la venta directa.
- **Un permiso nuevo.** Aplicar el saldo de un cliente a su propia compra no es una operación
  privilegiada: el saldo ya es suyo, y queda registrado en la venta. Si más adelante se ve abuso, se
  agrega entonces.

## Qué se prueba

| Qué | Cómo se comprueba |
|---|---|
| El monedero no suma al cajón | Una venta de $500 con $120 de monedero deja el efectivo esperado en $380, no en $500 |
| El servidor recorta | Pedir aplicar $9,999 con saldo de $120 aplica $120 |
| No excede el total | Saldo de $500 en una venta de $100 aplica $100, y quedan $400 |
| Público en General se rechaza | Con `cliente_id: 0` no se puede aplicar |
| El saldo baja | Tras aplicar $120, el cliente queda con lo que tenía menos $120 |
| Cancelar lo devuelve | Cancelar esa venta le regresa los $120 |
| Venta pagada entera con monedero | Se registra, descuenta inventario, y no suma efectivo |

**Y en la tienda:** vender a un cliente con saldo, aplicar parte, y comprobar que **el corte pide
exactamente lo que la cajera cobró en efectivo** — ni un peso más.
