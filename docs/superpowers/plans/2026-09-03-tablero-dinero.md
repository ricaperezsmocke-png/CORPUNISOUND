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

### 2. Las otras salidas de la tómbola — DECISIÓN TOMADA: **opción A** (Victor, 2026-09-03)

Victor dijo que de la tómbola también salen **nóminas y servicios**. Hoy el sistema no
tiene forma de registrar una salida de la tómbola que no sea un depósito.

**El riesgo está confirmado en el código, no es una sospecha.** `gastosEfectivoDelTurnoLista`
(`backend/gastos.js`) resta del cajón TODO gasto activo en `EFECTIVO` de esa sucursal y esa
caja dentro del turno. No existe ningún concepto de origen del dinero: ni en `crearGasto`,
ni en `depositos.js`, ni en `cortes.js`. Así que una nómina pagada desde la caja fuerte y
capturada como gasto en efectivo **le resta al cajón de la cajera dinero que nunca salió de
ahí**, y le inventa un faltante en su corte. Es un defecto anterior a este trabajo.

**Lo decidido (opción A):** una salida de tómbola es un concepto propio —depósito, nómina,
servicio u otro— con su caja, su comprobante y su bitácora. El depósito pasa a ser un tipo
de salida más. Consecuencias que se aceptan al elegirlo:

- El tablero cuadra siempre, y la cajera deja de cargar con gastos que no pagó.
- Es más trabajo que las otras dos opciones: hay que migrar los depósitos existentes al
  concepto nuevo sin reescribir su historia, y decidir qué pasa con las nóminas que HOY ya
  están capturadas como gastos en efectivo (no se reescriben; se documenta que los cortes
  viejos afectados quedan como están).
- Toca `backend/depositos.js` y el módulo de gastos, los dos de dinero. Va con revisión
  independiente antes de cada checkpoint, como el resto.

**Sigue abierto, y lo decide Victor cuando lleguemos a la Fase 4:** si al registrar una
salida de tómbola de tipo nómina o servicio hay que impedir que esa misma erogación se
capture además como gasto en efectivo (o solo advertirlo), para que no se reste dos veces.

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
4. **Las salidas de tómbola** como concepto propio (opción A): depósito, nómina, servicio
   u otro, con caja y comprobante, y el depósito convertido en un tipo de salida.

**Orden a resolver en el spec, antes de empezar:** con la opción A elegida, el depósito
acaba siendo un tipo de salida, así que puede convenir construir el concepto de salida
ANTES que `deposito.caja_id` y no después, para no hacer dos veces la misma migración.
Es la primera pregunta que el spec tiene que contestar.

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
