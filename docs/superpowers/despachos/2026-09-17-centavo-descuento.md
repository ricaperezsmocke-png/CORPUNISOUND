# Despacho: el centavo que descuadra el corte en las ventas con descuento

## Coordenadas

- **Worktree (unico lugar donde escribes):** `C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/centavo`
- **Rama:** `fix/centavo-descuento`
- **Commit base:** `80716b0`
- **Baseline de pruebas:** `1735` (1733 pass, 0 fail, 2 todo)
- **Comando (por archivo; NO corras la suite completa, se arrastra desde tu entorno):**
  `node --preserve-symlinks --preserve-symlinks-main --test backend/ventas.test.js`

**ESTO TOCA EL CAMINO DEL DINERO.** Lee `CLAUDE.md` y `AGENTS.md` de la raiz del repo antes de nada.

## El defecto, ya medido por Claude

**La pantalla y el servidor redondean en momentos distintos**, asi que el total que cobra la cajera y
el total que guarda el sistema difieren en **un centavo** en el **6.1%** de las ventas con descuento.

| Donde | Archivo | Que hace |
|---|---|---|
| Pantalla | `src/PuntoDeVenta.jsx:339-341` | Suma todo el carrito y todo el descuento **sin redondear**, y redondea al final al mostrar con `.toFixed(2)` |
| Servidor | `backend/ventas.js:211` | `bruto = redondear(cantidad * precio)` y luego `subtotal = redondear(bruto * (1 - descPct/100))`. **Redondea dos veces, por linea** |

**Medicion hecha por Claude** sobre 43,200 combinaciones realistas (precios terminados en .95 .99
.50 .00 de $1 a $200, descuentos de 3 a 30%, cantidades de 1 a 6): **2,640 casos con 1 centavo de
diferencia = 6.1%**. Va en los dos sentidos.

Casos concretos, verificados:

```
3 x $19.95 al 10%  ->  pantalla $53.86   servidor $53.87   (faltante para la cajera)
2 x $19.95 al  5%  ->  pantalla $37.91   servidor $37.90   (sobrante)
1 x $19.95 al 10%  ->  pantalla $17.95   servidor $17.95   (iguales)
2 x $19.95 al 10%  ->  pantalla $35.91   servidor $35.91   (iguales)
```

**Por que importa aunque sean centavos:** la cajera cobra lo que dice la pantalla y el corte de caja
espera lo que guardo el servidor. Es un descuadre que ella **no puede explicar**. Victor ya paso por
esto en otras formas y es lo que menos tolera del sistema.

## LA DECISION YA ESTA TOMADA: manda el SERVIDOR

Regla dura del proyecto (`CLAUDE.md`, "Las reglas de dinero", punto 1): **toda validacion de dinero
va en el servidor; lo que solo vive en `src/` es una sugerencia.**

Por lo tanto: **la PANTALLA se corrige para que calcule igual que el servidor.** NO al reves.
**No toques la formula de `backend/ventas.js`.** Si crees que la del servidor esta mal, **detente y
reportalo**, no la cambies.

La pantalla tiene que reproducir exactamente esto, por linea:
1. `bruto = redondear(cantidad * precio)`
2. `subtotal_linea = redondear(bruto * (1 - descuento_pct / 100))`
3. sumar los `subtotal_linea` y redondear
4. aplicar el descuento por forma de pago y redondear

donde `redondear(n)` es `Math.round((Number(n) || 0) * 100) / 100`, igual que `backend/ventas.js:24`.

**Ojo con el descuento por forma de pago:** la pantalla ya lo aplica en `totalConCondicion`
(`src/PuntoDeVenta.jsx:346`) y el servidor en `totalCalculado` (`backend/ventas.js:236`). Comprueba
que los dos queden igual **despues** de tu cambio, no solo el subtotal.

## Donde mirar en la pantalla: son TRES lugares, y los tres son parte del trabajo

Ya estan localizados. **Encontrarlos no es motivo para detenerse: es el encargo.**

1. **Calculo principal**, `src/PuntoDeVenta.jsx:338-350`: `subtotal`, `descuentoTotal`, `total`,
   `totalConCondicion`.
2. **Importe por articulo**, `src/PuntoDeVenta.jsx:842`.
3. **Ticket en espera**, `src/PuntoDeVenta.jsx:1183`.

Ya se reprodujo: con `3 x $19.95 al 10%`, el calculo principal da **$53.86**, el ticket en espera da
**$53.86**, y el servidor guarda **$53.87**. Los dos de la pantalla coinciden entre si y **los dos
estan mal** contra el servidor.

**Como se arregla:** crea la funcion de calculo en un archivo NUEVO de `src/`, exportala, y haz que
**los tres lugares la consuman**. Revisa ademas el resumen de cobro y la cotizacion (usos alrededor
de las lineas 1198, 1230, 1256). Al terminar **no puede quedar ni un calculo de total escrito a mano
en `PuntoDeVenta.jsx`**.

## Prueba obligatoria

Escribe una prueba automatica que **compare las dos formulas** —la del servidor y la de la pantalla—
sobre un barrido de combinaciones, y que falle si difieren en un solo centavo. Que incluya al menos
los cuatro casos concretos de arriba.

Ponla donde vive la logica de ventas del backend, y **exporta desde `src/` la funcion de calculo**
para poder probarla, en vez de copiar la formula en la prueba: una prueba que reimplemente la
formula no prueba nada.

**TDD: la prueba tiene que fallar ANTES de tu arreglo.** Si no la viste en rojo, no cuenta.

## Archivos autorizados

- `src/PuntoDeVenta.jsx` (y, si hace falta para poder probar, un archivo nuevo de calculo en `src/`)
- El archivo de pruebas que crees

**Prohibido:** `backend/ventas.js` y cualquier otro archivo del backend, `backend/cajas.js`,
`backend/apartados.js`, `render.yaml`, `package.json`, `package-lock.json`.

## Invariantes

- **Ninguna dependencia nueva.**
- **Ninguna linea de mas de 200 caracteres** (regla del repo; `PuntoDeVenta.jsx` ya tiene varias, no
  agregues mas y parte las que toques).
- No cambies el comportamiento del descuento en si: solo el momento del redondeo.
- El monedero NO es efectivo y el corte cobra `total - monedero_aplicado`: no lo muevas.

## Git

**NO hagas commit, ni `git add`, ni stash, ni checkout, ni push.** Deja los cambios en el arbol:
Claude revisa, corre la suite completa y prueba en navegador antes de commitear.

## Detente y reporta si

- Para cuadrar las dos formulas habria que tocar el servidor.
- Encuentras un calculo de total **FUERA de `src/PuntoDeVenta.jsx`**: en otro componente, en un
  reporte, en el corte de caja. Los tres de adentro ya estan listados arriba y **no** son motivo de
  parada.
- Un cambio tuyo mueve algun total que HOY ya coincide entre pantalla y servidor (por ejemplo
  `1 x $19.95 al 10% = $17.95` o `2 x $19.95 al 10% = $35.91`).

## Entrega

Que cambiaste, la prueba en rojo y luego en verde con su salida, y **el barrido completo diciendo
cuantas combinaciones difieren ahora** (tiene que ser cero).
