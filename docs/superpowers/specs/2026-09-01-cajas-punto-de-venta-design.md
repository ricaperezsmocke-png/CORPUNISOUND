# Cajas en el Punto de Venta y el Corte de Caja

Fecha: 2026-09-01
Estado: diseño aprobado por Victor, pendiente de plan de implementación

## Por qué existe este cambio

Hoy el Corte de Caja se define por **sucursal y tiempo**: son las ventas cerradas de esa
tienda desde el último corte hasta ahora (`backend/cortes.js:33`). Unisound cobra por dos
vías —una administrativa y una fiscal— y hoy el dinero de ambas cae en el mismo corte,
sin forma de saber cuánto le toca a cada una ni dónde se descuadró.

## Qué hace SICAR, y en qué nos apartamos a propósito

Victor aportó dos capturas de SICAR v4.0.1328:

1. **Diálogo "Seleccionar Caja"**: una lista con `Caja 1 FISC` y `Caja 2 ADMIN`, un
   buscador y un botón **Agregar (F3)**.
2. **Pantalla principal**: arriba a la derecha, junto al usuario, se lee de forma
   permanente `Caja 2 ADMIN`.

De ahí salen dos conclusiones:

- **En SICAR "fiscal" y "administrativa" no son tipos del sistema.** Son nombres de texto
  que alguien le escribió a dos cajas. SICAR solo tiene un catálogo de cajas con nombre.
  Aquí tampoco hay un campo `tipo` con reglas detrás: sería una invención nuestra.
- **SICAR permite N cajas; aquí son exactamente dos, y no se administran.** Victor pidió
  dar de alta solo `Administrativa` y `Fiscal`. Sin catálogo abierto, sin botón de
  agregar, sin pantalla de administración. Si algún día hace falta una tercera, se abre
  entonces: hoy sería código que nadie usa.

Lo que sí copiamos de SICAR es lo que su gente ya tiene aprendido: **la caja siempre
visible en la barra superior**.

## Decisiones congeladas

Tomadas por Victor durante el diseño. No re-decidir durante la implementación:

1. **La caja es un mostrador de cobro**, no una clasificación de la venta.
2. **Exactamente dos cajas por sucursal**: `Administrativa` y `Fiscal`, sembradas al
   arrancar. No se crean, no se borran, no se renombran desde la interfaz.
3. **`Administrativa` es la predeterminada.** El sistema abre siempre ahí, sin preguntar
   nada a nadie.
4. **La caja no restringe nada**: cualquier caja emite cualquier tipo de documento.
5. **La misma cajera opera y corta las dos.** No hay permisos distintos por caja ni una
   segunda persona.
6. **La caja queda fija y visible en la barra superior**, y se cambia con un clic ahí.
   (Victor consideró elegirla en cada venta y lo descartó al ver la referencia de SICAR.)
7. **Una venta puede corregir su caja solo mientras no se haya cortado.** Ver "Corregir
   la caja de una venta".

## Alcance negativo — qué NO se toca

- **No se tocan los tipos de documento.** Siguen igual y disponibles en ambas cajas.
- **No se toca inventario, catálogo de productos ni precios.**
- **No se toca la lógica de apartados.** Su dinero se sigue contando por abono real y
  nunca por el total de la venta (`backend/cortes.js:42`): es la protección contra dinero
  duplicado que ya existe.
- **No se tocan las fórmulas del corte** (calculado, contado, diferencia, retiro). Lo
  único que cambia es **qué ventas entran** en cada corte.
- **No se reescribe ninguna venta ni ningún corte histórico.**
- **No se construye administración de cajas.** Ni alta, ni baja, ni renombrar.

## Modelo de datos

Colección nueva `DB.pos.cajas`, siguiendo el patrón de `DB.pos.sucursales`
(`backend/server.js:171`) y sembrada al arrancar como `sembrarRolesIniciales` y
`sembrarCategoriasGastos`:

```js
{ id: 1, nombre: "Administrativa", sucursal_id: 1, predeterminada: true }
{ id: 2, nombre: "Fiscal",         sucursal_id: 1, predeterminada: false }
```

Dos por cada sucursal existente. La siembra es idempotente: si ya existen, no las
duplica.

`predeterminada` marca **una sola caja por sucursal** y es la que absorbe las ventas
históricas sin caja (ver "La trampa del primer día"). No se deduce por el id más bajo ni
por orden de creación: es un campo explícito, porque de esa marca depende que no se
pierda dinero. Si una sucursal quedara con dos marcadas o con ninguna, es un error de
datos y el arranque debe gritarlo, no elegir en silencio.

Campos nuevos:

- `DB.pos.ventas[].caja_id` — la caja donde se cobró.
- `DB.pos.cortes_caja[].caja_id` — la caja de la que es el corte.

Ambos pueden ser `null` en los registros anteriores a este cambio.

## Selección y sesión

- **Arranca siempre en `Administrativa`.** No se pregunta en el login ni en ningún lado.
- La caja se guarda en `localStorage` como `caja_activa`, al lado de `sucursal_activa`
  (`src/api.js:38-45`), y viaja al backend por el mismo camino.
- Se muestra siempre en la barra superior junto al nombre del usuario. Un clic ahí la
  cambia entre las dos.
- Cambiar de sucursal reposiciona la caja en la `Administrativa` de la nueva tienda.

**El backend no confía en el cliente**: la venta se guarda con la caja que el cliente
declara, pero el servidor verifica que exista y **pertenezca a la sucursal del alcance de
la sesión**. Una venta no puede caer en la caja de otra tienda.

**Sesiones abiertas el día del despliegue.** Habrá gente dentro sin `caja_activa`, porque
el campo no existía cuando entraron. Esas sesiones caen en `Administrativa`, que es la
predeterminada y el comportamiento esperado por Victor: no hay nada que preguntar ni
nada que adivinar.

**De quién es el corte.** Se corta la caja de la sesión, no otra. Para cortar la Fiscal
se cambia de caja arriba y se corta. El historial de cortes se ve de ambas con el permiso
`ver_historial_cortes` que ya existe.

## El corte pasa a ser por caja

`ventasDelTurno` (`backend/cortes.js:32`) cambia su criterio de "ventas cerradas de esta
sucursal desde el último corte de esta sucursal" a "de esta **caja** desde el último corte
de esta **caja**". Cada caja tiene su propia línea de tiempo: cerrar el turno de una no
mueve el de la otra.

Todo lo demás del corte se queda igual, incluidos los gastos en efectivo del turno
(`backend/gastos.js`), que se filtran por la misma ventana de tiempo de esa caja.

## Corregir la caja de una venta

En la pantalla de consulta de ventas —donde hoy se cancelan— se puede cambiar la caja de
una venta cobrada por equivocación en la otra.

**La regla dura: solo mientras esa venta no haya entrado en un corte cerrado.** Una vez
cortada, su caja queda congelada y el botón no aparece.

La razón está en los datos: un corte guarda una **foto congelada** de sus totales
(`calculado`, `contado`, `diferencia`, `ventas_incluidas`, `total_*` en
`backend/cortes.js:137-160`) y no se recalcula nunca. Si una venta cambiara de caja
después de cerrado su corte, el corte seguiría afirmando que esa venta fue suya mientras
la venta afirmaría lo contrario. Dos registros contradiciéndose para siempre, y el día
que alguien investigue un descuadre viejo no habrá manera de saber cuál miente.

Cómo se determina si ya se cortó: la venta ya entró en un corte si existe un corte de su
caja cuyo `fecha_hora` es posterior o igual al `fecha_hora` de la venta. Es el mismo
criterio con el que `ventasDelTurno` decide qué entra en el turno, así que no puede
desalinearse con él.

Requiere el permiso nuevo `cambiar_caja_venta` (módulo `pos`), registrado en
`backend/permisosCatalogo.js` y administrable desde Roles y Personal, que es la regla
permanente del sistema. El cambio deja constancia en la venta de quién lo hizo y cuándo:
mover dinero de una caja a otra no puede ser anónimo.

## La trampa del primer día

**Este es el riesgo serio del cambio.**

El día del despliegue la base tendrá ventas cerradas **sin `caja_id`**: todo el histórico.
Si el corte solo mirara ventas de su caja, esas ventas no caerían en ningún corte —
desaparecerían del cálculo. La primera cajera que corte ese día vería menos dinero
calculado del que tiene en el cajón: un descuadre inventado por nosotros, el primer día,
en el dinero del negocio.

**Solución, sin reescribir nada:** el corte de la caja `Administrativa` de una sucursal
incluye, además de sus propias ventas, **las ventas de esa sucursal con `caja_id` nulo**.
La `Fiscal` no las ve nunca. Así ningún peso queda huérfano y ningún peso se cuenta dos
veces. Las ventas históricas se quedan exactamente como están, para siempre: no hay
migración y no hay nada que revertir.

## Pruebas

TDD, rojo antes que verde. Estas pruebas protegen dinero, así que la tabla mínima es
explícita:

- Las dos cajas de una sucursal **no se roban ventas**: lo cobrado en `Administrativa` no
  aparece en el corte de `Fiscal`.
- Cerrar el corte de una **no mueve** la línea de tiempo de la otra.
- Una venta vieja **sin `caja_id`** cae en el corte de la `Administrativa` de su sucursal
  **y solo ahí**: ni en la `Fiscal`, ni dos veces.
- Una venta no puede guardarse con una caja de **otra sucursal**, aunque el cliente lo
  pida.
- Sin caja declarada, la venta cae en la `Administrativa` de su sucursal.
- **Cambiar la caja de una venta no cortada** la mueve del turno de una al de la otra.
- **Cambiar la caja de una venta ya cortada se rechaza**, y el corte cerrado queda intacto.
- La siembra es **idempotente**: arrancar dos veces no crea cuatro cajas.
- Los apartados siguen contando por abono real y no por su total, con cajas de por medio.
- Los gastos en efectivo del turno se restan de la caja correcta.

**Verificación en navegador obligatoria**: cobrar en ambas cajas de una misma tienda,
corregir la caja de una venta, y cortar las dos por separado comprobando que los totales
no se mezclan.

## Riesgos

| Riesgo | Contención |
|---|---|
| Ventas históricas fuera de todo corte el primer día | La `Administrativa` absorbe las de `caja_id` nulo; prueba dedicada |
| Un corte cerrado se contradice con sus ventas | No se puede cambiar la caja de una venta ya cortada; prueba dedicada |
| Cobrar en la caja equivocada por no mirar el indicador | La caja está siempre visible arriba, y la corrección existe mientras no se corte |
| Una venta cae en la caja de otra tienda | El backend valida la caja contra el alcance de la sesión |
| Dinero contado dos veces | Solo la `Administrativa` ve las ventas sin caja; prueba explícita de no duplicación |

## Deuda declarada, fuera de este trabajo

`TIPOS_DOCUMENTO` está copiada en cuatro archivos (`src/PuntoDeVenta.jsx`,
`src/Configuracion.jsx`, `src/ConsultasVentas.jsx`, `src/reportes/ReporteVentas.jsx`) y no
todas las copias traen los mismos valores: solo la de reportes incluye `Apartado`, y dos
anteponen `Todos`. Es la misma trampa de definiciones duplicadas que se corrigió en el
Radar.
