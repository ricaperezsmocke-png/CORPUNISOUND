# Radar de Demanda — núcleo nuevo (diseño aprobado)

**Rama:** `feature/radar-nucleo`
**Worktree:** `C:\Users\Victor\Desktop\CORPUNISOUND-nucleo`
**Commit base:** `5b0ef2f feat(radar-demanda): link purchase intent to CRM`
**Fecha:** 2026-08-22
**Aprobado por:** Victor

## Qué es Radar de Demanda

Cuando un cliente pregunta por un producto que la tienda no le puede vender, el
vendedor lo captura: el producto (del catálogo o escrito a mano) y **por qué no
se vendió** — no hay existencia, no lo manejamos, quería otra marca, otra
variante, precio, tiempo de entrega.

Si además el cliente **pide que le avisen cuando llegue**, eso es un
consentimiento: pasa al CRM como prospecto y queda en seguimiento.

## Por qué se rehace el núcleo

Una revisión adversarial de Codex sobre `feature/radar-demanda`, verificada
después contra el código por Claude, encontró tres defectos reales. Los tres
viven en un solo archivo de 743 líneas que mezcla modelo, validación, reglas de
estado, métricas y CRM.

Se rehace **el backend**. Las pantallas no se tocan.

### Defecto 1 — el consentimiento se puede falsear con una cadena

`server.js:656` decide con `if (req.body?.intencion_compra)` y
`radarDemanda.js:258-259` guarda con `!!datos.intencion_compra`. En JavaScript la
cadena `"false"` es verdadera: un cliente que mande `intencion_compra: "false"`
da de alta un prospecto en el CRM y **queda registrado que aceptó recibir el
aviso cuando nunca lo aceptó**.

Importa más de lo que parece: el destino de este módulo es que el aviso salga
solo por WhatsApp, y Meta exige opt-in comprobable. Un consentimiento falso deja
de ser un dato sucio y pasa a ser un mensaje no solicitado saliendo del número de
la empresa.

### Defecto 2 — CONVERTIDA sin venta, y la misma venta para varias demandas

`cambiarEstado` (líneas 435-441) solo valida la venta **si el campo viene en la
petición**; si se omite, la demanda pasa a CONVERTIDA con la venta en nulo.
`validarVenta` (182-190) comprueba que la venta exista y sea de la sucursal, pero
no que ya esté ligada a otra demanda.

Con eso la recuperación se puede inflar sin haber vendido nada, y una sola venta
puede figurar como recuperación de varias demandas.

### Defecto 3 — dos fórmulas de conversión conviviendo

| Endpoint | Fórmula | ¿Aprobada? |
|---|---|---|
| `/analisis` (`metricasRegistros:604`) | `CONVERTIDA / (CONVERTIDA + NO_CONVERTIDA)` | sí |
| `/resumen` (`obtenerResumen:548`) | `CONVERTIDA / total de registros` | no |

Con 1 convertida y 9 registradas, un tablero dice 10% y el otro 100% sobre los
mismos datos.

Agravante encontrado al revisar: `radarDemandaCincoSucursales.test.js:66`
**recalcula la fórmula defectuosa dentro de la propia prueba**. Hay una prueba en
verde que consagra el error.

## Decisiones de arquitectura

### Persistencia: se queda en el documento JSON

Radar vive en `DB.radar_demanda` (`registros` + `seguimientos`). Se evaluó
moverlo a tablas SQLite como Centro de Leads y **se descartó**:

- Radar tiene que cruzarse con ventas, productos y existencias, y todo eso vive
  en el JSON. Mover solo Radar lo deja hablando con dos mundos.
- El detector de llegada (fase B) necesita mirar inventario, también en el JSON.
- Cero migración: lo capturado en staging sobrevive.
- El volumen no lo justifica: cientos de demandas al año.

Contrapartida aceptada: el invariante "una venta no recupera dos demandas" se
garantiza en el dominio con una prueba que lo fija, no con un índice único de la
base. Es más débil, y se asume a conciencia.

### Estructura por capas

`backend/radar/`, una responsabilidad por pieza:

| Archivo | Responsabilidad |
|---|---|
| `modelo.js` | Forma del registro, normalización, ids, copia defensiva |
| `entrada.js` | Validación estricta de lo que llega: booleanos reales, teléfono, cantidad, motivo |
| `reglasEstado.js` | Estados, transiciones e invariantes de cierre |
| `metricas.js` | Una sola definición de conversión y recuperación |
| `vinculoCrm.js` | Alta y enlace del prospecto en CRM |
| `consultas.js` | Listados, filtros y alcance por sucursal |

`radarDemanda.js` queda como **fachada**: exporta exactamente lo que `server.js`
ya importa. `radarDemandaInteligencia.js` y `radarDemandaReglas.js` (que son de
Inteligencia de Compras) no se tocan.

## Reglas congeladas

### Consentimiento

`intencion_compra` y `consentimiento_aviso` deben ser **booleanos reales**:

- Campo **ausente** (`undefined`) o `null` significa **`false`**. El campo es
  opcional y la mayoría de las capturas no lo mandan; exigirlo rompería la
  captura normal.
- Campo **presente con un valor que no es booleano** — `"false"`, `"true"`,
  `"0"`, `0`, `1`, `""`, `[]` — se rechaza con **400 antes de tocar el CRM**.

Prohibido `!!valor` sobre entrada externa.

Sin `intencion_compra` no hay alta en CRM. Con intención, el consentimiento es
obligatorio, el nombre es obligatorio y el teléfono debe traer 10 dígitos.

### Cierre en CONVERTIDA

Entrar a `CONVERTIDA` **exige una venta ligada y válida**:

1. la venta existe y es de la sucursal de la demanda;
2. **no está ligada a ninguna otra demanda**.

Si falta la venta, el estado no cambia. La demanda que no se recuperó tiene su
propio estado: `NO_CONVERTIDA`.

**Y una demanda ya cerrada como CONVERTIDA no puede quedarse sin su venta.**
Regla aprobada por Victor el 2026-08-22, a raíz de un hueco que encontró Codex
al implementar la Tarea 3 y que Claude reprodujo: no se podía *entrar* a
CONVERTIDA sin venta, pero una vez dentro un `PATCH` normal con
`venta_recuperada_id: null` se la quitaba, dejando una demanda convertida sin
respaldo. El mismo defecto por la puerta de atrás, en dos pasos.

Si alguien ligó la venta equivocada, se corrige poniendo **otra venta válida y
libre**, nunca dejándola en blanco. La regla aplica **solo** a `CONVERTIDA`:
cualquier otro estado puede tener la venta en nulo, y una demanda convertida
sigue siendo editable en todo lo demás (notas, contacto, seguimiento).

### Métricas

```
conversion   = CONVERTIDA / (CONVERTIDA + NO_CONVERTIDA)
recuperacion = CONVERTIDA / (PENDIENTES + CONVERTIDA + NO_CONVERTIDA)
```

Definidas **una sola vez** en `metricas.js`. `/resumen` y `/analisis` beben de
ahí y devuelven además **numerador y denominador explícitos**, para que el número
se pueda comprobar a mano. Las canceladas no entran en ninguna de las dos.
Denominador cero devuelve 0, nunca `NaN` ni división por cero.

### CRM: dato crudo, no etiqueta

El CRM ya tiene las dos cosas y hoy no coinciden: la etiqueta manual `estado`
(Contactado / Interesado / En tienda / Compró / Perdido) y las ventas reales
(`crm.js:24 comprasDeCliente`). El conteo de convertidos por sucursal
(`crm.js:187`) usa la **etiqueta**, así que alguien puede figurar como convertido
sin haber comprado.

Se congela:

- **"Ya compró" se deriva de ventas cerradas reales.** No se captura, no se
  etiqueta, no se puede olvidar de actualizar.
- **"Prospecto" = cero ventas cerradas.** Ese es el que "vamos a ver si compra".
- El cliente creado desde Radar lleva **`origen: "radar"`**, para poder responder
  la única pregunta que mide si el módulo sirve: de los prospectos que entraron
  por Radar, ¿cuántos terminaron comprando?
- Los clientes que ya existen **sin** `origen` se quedan sin él. No se inventa de
  dónde salieron.
- La etiqueta `estado` sigue viva para el seguimiento del vendedor; solo deja de
  ser la fuente de la verdad de "compró".

**Consecuencia aceptada:** el número de convertidos del CRM va a cambiar en
cuanto se mida con ventas reales, y probablemente baje. No se rompe nada: hoy
está midiendo otra cosa.

## Contrato HTTP

Las 11 rutas quedan idénticas en camino, método y forma de respuesta. Las
pantallas no se tocan.

Dos comportamientos observables cambian, a propósito:

1. `POST /api/radar-demanda` responde **400** ante booleanos falsos. Antes los
   aceptaba.
2. `GET /resumen` devuelve la conversión con la fórmula aprobada. **Su número
   cambia** — hoy reporta mal.

## Alcance y multisucursal

Sin cambios de política: el alcance se deriva del token y `?sucursal_id=` nunca
lo ensancha. Se conserva `sucursalDeEscritura` y el comentario ya presente en
`server.js` de que el cuerpo de la petición nunca decide dónde se guarda.

## Pruebas

TDD estricto: cada arreglo entra con su prueba en rojo primero.

**Baseline verificado el 2026-08-22** sobre `5b0ef2f`, corriendo los nueve
archivos de prueba de Radar en este worktree: **193 pruebas, 193 PASS, 0 FAIL**.
(El "186" que circulaba es anterior a los dos últimos incrementos.)

Las 193 deben seguir pasando, **salvo una**, que se corrige a propósito porque
fija el comportamiento defectuoso:

- `radarDemandaCincoSucursales.test.js:66` — recalcula dentro de la prueba la
  fórmula errónea `convertidas / total`.

Se verificó que **ninguna prueba existente fija el comportamiento del booleano en
cadena**: no hay ni un `intencion_compra: "..."` ni un `consentimiento_aviso:
"..."` en toda la suite. Ese arreglo no rompe nada; solo agrega casos nuevos.

**Prohibido** modificar una prueba para que pase. Si una prueba estorba, se
explica por qué el comportamiento que fijaba estaba mal.

Casos nuevos mínimos:

- `"false"`, `"0"`, `1` en ambos booleanos → 400, y el CRM no cambia.
- `null` y campo ausente → `false`, sin error: la captura normal no manda el campo.
- CONVERTIDA sin `venta_recuperada_id` → se rechaza.
- Misma venta en dos demandas → la segunda se rechaza.
- `/resumen` y `/analisis` coinciden para el mismo alcance y periodo.
- Denominador cero en ambas tasas.
- Cliente creado desde Radar lleva `origen: "radar"`.
- "Ya compró" se deriva de ventas, no de la etiqueta.

## Fuera de alcance

- **Fase B** — detector de llegada de mercancía y aviso. Solo dispara cuando la
  mercancía llega **a la sucursal donde el cliente preguntó**. Depende de que
  Meta apruebe la cuenta de WhatsApp Business para el envío automático.
- **Fase C** — pedido especial / express. No existe en el sistema y es un módulo
  aparte: implica compromiso con el cliente, proveedor, tiempo de entrega y
  probablemente anticipo, o sea dinero, Compras y Corte de Caja.
- Cualquier cambio de pantallas.
- `radarDemandaInteligencia.js` y `radarDemandaReglas.js`.

## Git

Rama `feature/radar-nucleo` sobre `5b0ef2f`. Sin merge a master, sin push y sin
despliegue sin autorización explícita de Victor.
