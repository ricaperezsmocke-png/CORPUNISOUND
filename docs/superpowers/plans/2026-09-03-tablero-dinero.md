# Tablero de Dinero — cuánto efectivo tiene cada tienda

## Contexto

El contador necesita saber, sin llamar a nadie, **cuánto efectivo hay en cada tienda** para
decidir depósitos, nóminas y pagos de servicios. Hoy ese número no existe en ninguna
pantalla: hay que sumar cortes a mano y restar depósitos de memoria.

Victor describió el circuito real del dinero:

```
venta  →  CAJÓN de la cajera        (de ahí sale el cambio; es lo que cuenta el corte)
       →  al cortar, el RETIRO saca dinero del cajón
       →  TÓMBOLA (caja fuerte)     (se acumula día tras día)
       →  de la tómbola salen depósitos, nóminas y servicios, en cantidades variables
```

El **retiro del corte** es el puente entre el cajón y la tómbola, y ya se registra hoy. Eso
hace que casi todo el tablero sea calculable con datos que ya existen.

Y una respuesta de Victor decide el diseño: **quien saca dinero de la tómbola sabe de cuál
caja es**. Por eso el desglose administrativa/fiscal puede ser exacto en vez de una
estimación. Si no fuera así, el saldo por caja sería ficción y habría que reportar un solo
número.

## El modelo: el dinero está en tres sitios

Por cada **sucursal** y cada **caja** (Administrativa / Fiscal):

| Dónde | Qué es | Cómo se calcula |
|---|---|---|
| **En el cajón** | Lo que la cajera tiene ahora para operar y dar cambio | Fondo que quedó del último corte (`contado − retiro`) + lo cobrado en el turno abierto (`calcularCorteEnCurso`) |
| **En la tómbola** | Lo resguardado de días anteriores, sin depositar | Σ retiros en efectivo de los cortes − Σ salidas (depósitos y demás) |
| **Total de la tienda** | Lo que el contador puede disponer | Cajón + tómbola |

Y aparte, lo que Victor pidió explícitamente: **el total de los cortes del día**, separado
del acumulado de días anteriores. Son preguntas distintas: "¿cuánto se vendió hoy?" y
"¿cuánto dinero hay guardado?".

## Lo que ya existe y hay que reutilizar

- `backend/cortes.js` — los cortes ya guardan `caja_id`, `contado`, `retiro`, `calculado` y
  `fecha`. **El retiro por forma de pago ya está ahí**: es la entrada a la tómbola.
- `backend/depositos.js` — depósitos con `sucursal_id`, `monto`, `forma_pago`, `estatus` y
  bitácora. Son la salida principal de la tómbola.
- `calcularCorteEnCurso` — lo que hay en el cajón del turno abierto, ya por caja.
- `backend/auth.js` — `alcanceSucursal` y `dentroDeAlcance` para que cada quien vea solo
  sus tiendas, y el contador con alcance global las vea todas.

**No se inventa maquinaria nueva de dinero.** El tablero es sobre todo una lectura.

## Lo que falta

### 1. `deposito.caja_id`

Los depósitos no saben de qué caja sale el dinero. Sin eso el saldo por caja se desarma en
cuanto se hace el primer depósito. Es el mismo hueco que ya se tapó en ventas, abonos y
gastos, y se resuelve igual: campo nuevo, validado contra la sucursal, reutilizando
`backend/cajas.js`. Los depósitos históricos sin caja los absorbe la predeterminada, como
todo lo demás.

### 2. Las otras salidas de la tómbola — DECISIÓN PENDIENTE, LEER

Victor dijo que de la tómbola también salen **nóminas y servicios**. Hoy el sistema no
tiene forma de registrar una salida de la tómbola que no sea un depósito.

Y hay un riesgo real detrás: si esas nóminas se registran hoy como **gastos en efectivo**,
`gastosEfectivoDelTurno` las está restando **del cajón de la cajera**, que es dinero que
nunca salió de ahí. Eso le inventa un faltante a la cajera y descuadra su corte. Es
anterior a este trabajo y hay que comprobarlo antes de construir el tablero, porque cambia
el número.

Tres caminos:

- **(A, recomendado)** Una salida de tómbola es un concepto propio: depósito, nómina,
  servicio u otro, todas con su caja y su comprobante. El depósito pasa a ser un tipo de
  salida. El tablero cuadra siempre y la cajera deja de cargar con gastos que no pagó.
- **(B)** Solo se cuentan los depósitos. El tablero es exacto para tiendas que solo
  depositan, y **sobreestima** el saldo de las que pagan nóminas desde la caja fuerte.
- **(C)** Las nóminas se siguen registrando como gastos, y se marcan con un origen
  (cajón / tómbola) para que resten del sitio correcto.

**Esto lo decide Victor antes de empezar.** Sin esa decisión el tablero puede dar un número
mayor al real, que es justo el error que no se puede cometer en un tablero de dinero: hace
que el contador cuente con efectivo que no está.

## La pantalla

Un módulo nuevo, **Tablero de Dinero**, en Administración, con su permiso propio
(`ver_tablero_dinero`) registrado en `backend/permisosCatalogo.js`.

Por cada tienda que el usuario alcance:

```
OCOSINGO                          Administrativa      Fiscal        Total
  En el cajón                          $ 4,200        $ 1,100      $ 5,300
  En la tómbola                       $ 38,500       $ 12,000     $ 50,500
  ─────────────────────────────────────────────────────────────────────────
  Disponible en la tienda             $ 42,700       $ 13,100     $ 55,800

  Cortes de hoy: 2 · $ 9,340
```

Y abajo, un total de toda la cadena. Cada cifra tiene que poder abrirse para ver de dónde
sale —qué cortes, qué depósitos— porque un número de dinero que no se puede comprobar no
sirve para decidir.

## Fases

1. **`deposito.caja_id`** con su validación y sus pruebas. Sin frontend.
2. **El cálculo del tablero** en un módulo nuevo de solo lectura
   (`backend/tableroDinero.js`), con su ruta y su permiso. Aquí van las pruebas fuertes:
   saldos por caja, alcance por sucursal, depósitos cancelados que no restan, cortes de hoy
   separados del acumulado.
3. **La pantalla**, con el desglose abierto por cifra.
4. **Las salidas de tómbola**, según lo que Victor decida en el punto 2 de arriba.

Cada fase se revisa antes de la siguiente. Es dinero.

## Verificación

```
node --test backend/
npx eslint src backend --quiet
```

Y a mano, en el navegador, la prueba que de verdad importa: cobrar, cortar con retiro,
registrar un depósito, y comprobar que **el dinero que sale del cajón aparece en la tómbola
y que el depósito lo baja**, con el desglose por caja cuadrando en cada paso.

## Fuera de alcance

- No se toca la lógica del corte ni el sellado: están cerrados y probados.
- No se reescribe ningún corte ni depósito histórico.
- No es un módulo de contabilidad: no lleva cuentas, no concilia bancos, no emite pólizas.
  Contesta una sola pregunta —cuánto efectivo hay en cada tienda— y la contesta bien.
