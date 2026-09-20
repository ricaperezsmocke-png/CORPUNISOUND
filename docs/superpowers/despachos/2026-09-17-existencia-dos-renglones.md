# Despacho: una venta se salta la existencia si el mismo producto viene en dos renglones

## Coordenadas

- **Worktree (unico lugar donde escribes):** `C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/existencia`
- **Rama:** `fix/existencia-renglones`
- **Commit base:** `80716b0`
- **Baseline de pruebas:** `1714 pass / 0 fail`
- **Comando (por archivo; NO corras la suite completa, se arrastra desde tu entorno):**
  `node --preserve-symlinks --preserve-symlinks-main --test backend/ventas.test.js`

**ESTO ES UNA FUGA DE INVENTARIO.** Lee `CLAUDE.md` y `AGENTS.md` de la raiz antes de nada.

## El defecto, YA reproducido por Claude ejecutando el codigo real

`backend/ventas.js:97-109` valida la existencia **renglon por renglon**: compara `l.cantidad` contra
el disponible completo, uno por uno. Si el mismo `producto_id` viene en DOS renglones, cada uno pasa
por separado y **se vende mas de lo que hay**.

Reproduccion ejecutada con `crearVenta` de produccion, existencia inicial **3 piezas**:

| Caso | Resultado real |
|---|---|
| Un renglon de 4 | Rechazada correctamente |
| **Dos renglones de 2** | **SE ACEPTA. La existencia queda en -1** |
| **Tres renglones de 2** | **SE ACEPTA. La existencia queda en -3** |

El script de reproduccion esta en
`C:/Users/Victor/AppData/Local/Temp/claude/C--Users-Victor/f2f2bdb2-8762-4ff9-a84b-bad1b0b77709/scratchpad/probar_existencia.js`.
**Leelo y usalo como guia para la prueba**, pero la prueba definitiva va dentro del repo.

## La solucion ya existe en este mismo repo: copiala

`backend/apartados.js:106-124` **ya lo hace bien**: agrupa las cantidades por producto ANTES de
comparar. Su propio comentario lo dice: *"agrupando por producto por si el mismo producto aparece en
mas de un renglon"*. Alguien lo arreglo ahi y **no lo replico en ventas**.

**Haz que `ventas.js` valide igual que `apartados.js`.** No inventes una tercera forma.

**Si al hacerlo ves que conviene extraer esa validacion a una sola funcion compartida** para que no
vuelvan a separarse, hazlo: ponla en un archivo del backend y que la usen los dos. Es lo que este
proyecto ya hizo con `esDeEstaCaja`. Pero **solo si puedes dejar apartados funcionando exactamente
igual que hoy**; si no, arregla solo ventas y reporta la idea.

## Lo que NO cambia

- **Los articulos rapidos** (lineas sin `producto_id`) se siguen saltando la validacion a proposito:
  no tienen catalogo contra el cual validar. No los toques.

- **La bandera `permitir_ventas_sin_existencia` es un interruptor de TODO O NADA y asi se queda.**
  No la conviertas en un tope parcial. Esto responde por adelantado la duda obvia: la regla de
  "la existencia nunca queda negativa" aplica **SOLO cuando la bandera esta APAGADA**.
  - **Bandera APAGADA (se valida):** la validacion tiene que ser hermetica. Ninguna venta puede
    dejar la existencia negativa. Ahi va toda tu prueba, y ahi esta el hueco que vienes a cerrar.
  - **Bandera ENCENDIDA (no se valida):** no valides, no agrupes, no bloquees. La venta pasa aunque
    la existencia quede negativa: **eso es lo que Victor pidio al encenderla, no un defecto.** Tu
    prueba de ese caso solo comprueba que **sigue pasando igual que hoy**.
  El codigo actual ya esta escrito asi: toda la validacion vive dentro de
  `if (!config.permitir_ventas_sin_existencia)`.
- El mensaje de error debe seguir diciendo el nombre del producto, el disponible y lo solicitado,
  porque lo lee la cajera en pantalla. Con el agrupamiento, **"solicitado" ahora es la suma**.

## Prueba obligatoria (TDD)

1. Una prueba que reproduzca el fallo: existencia 3, venta con **dos renglones de 2 del mismo
   producto**, y que exija que la venta **se rechace** y la existencia **quede en 3**.
2. **Verifica que esta en ROJO antes de arreglar.** Si no la viste fallar, no cuenta.
3. Casos que tambien deben quedar cubiertos:
   - Un solo renglon que excede: se sigue rechazando (ya funciona, no lo rompas).
   - Dos renglones que **juntos caben** (existencia 5, renglones de 2 y 2): **se acepta**, y la
     existencia baja a 1.
   - Dos productos DISTINTOS en dos renglones: cada uno se valida contra el suyo, no se suman entre
     si.
   - Un articulo rapido junto a un producto de catalogo: el rapido no estorba la validacion.
   - Con `permitir_ventas_sin_existencia` activa: la venta pasa aunque no haya existencia.
4. **Comprueba que la existencia nunca queda negativa** en los casos aceptados.

Escribe las pruebas donde vivan las de ventas (`backend/ventas.test.js` o el archivo que
corresponda segun lo que ya exista).

## Archivos autorizados

- `backend/ventas.js`
- El archivo de pruebas de ventas que corresponda
- `backend/apartados.js` **solo si** extraes la funcion compartida, y sin cambiar su comportamiento
- Un archivo nuevo del backend para la funcion compartida, si la extraes

**Prohibido:** `src/`, `backend/server.js`, `backend/cajas.js`, `backend/cortes.js`, `render.yaml`,
`package.json`, `package-lock.json`.

## Invariantes

- **Ninguna dependencia nueva.**
- **Ninguna linea de mas de 200 caracteres.**
- La guarda **falla cerrando**: ante la duda, rechaza la venta.
- No cambies como se descuenta la existencia al confirmar, solo la validacion previa.

## Git

**NO hagas commit, ni `git add`, ni stash, ni checkout, ni push.** Deja los cambios en el arbol:
Claude revisa, corre la suite completa y commitea.

## Detente y reporta si

- Para arreglarlo hay que tocar un archivo fuera de la lista.
- Descubres un TERCER lugar que valide existencia de otra forma (por ejemplo cotizaciones,
  traspasos o MercadoLibre). Eso seria un hallazgo nuevo y mas grande.
- Una prueba existente se pone roja.

## Entrega

La prueba en rojo y luego en verde con su salida, que archivos tocaste, y **la reproduccion de los
tres casos de la tabla de arriba corriendo contra tu arreglo**: los tres deben quedar rechazados o
con la existencia correcta, ninguno en negativo.
