# Despacho: spec y plan de "Radar de Demanda por familias" (rehecho sobre master)

## Proyecto y contexto

CORPUNISOUND, punto de venta de Unisound (cadena de tiendas de instrumentos musicales en Chiapas).
Modulo **Radar de Demanda**: los vendedores registran lo que un cliente pidio y no habia, para decidir
que comprar.

**El problema del dueno, en sus palabras:** "se repiten guitarras, pero si cambian la marca lo
registra como otra guitarra y eso no ayuda". Necesita ver cuantas guitarras le piden en total, sin
importar la marca, y por debajo el desglose.

## Alcance de este despacho

**SOLO ESCRIBIR DOS DOCUMENTOS.** No toques codigo, no crees ramas, no corras servidores.

1. `docs/superpowers/specs/2026-09-15-radar-familias-v2-design.md`
2. `docs/superpowers/plans/2026-09-15-radar-familias-v2.md`

Trabajas en el checkout principal `C:/Users/Victor/Desktop/CORPUNISOUND` (rama `master`, commit base
`753af75`). Esos dos archivos son los UNICOS que puedes crear o modificar. No hagas `git add`, ni
commit, ni stash, ni checkout.

Para leer la rama vieja usa el worktree `C:/Users/Victor/Documents/Codex/worktrees/CORPUNISOUND-radar-familias`
(commit `78b0bef`) **en solo lectura**.

## Decisiones ya tomadas por Victor (NO las re-decidas)

1. **SOLO REGLAS.** Nadie junta ni separa demandas a mano. Si algo se agrupa mal, se corrige la regla
   y se reagrupa parejo. Toda la edicion manual de clasificacion que traia `78b0bef` queda FUERA:
   editor de familia/tipo, agregar/quitar articulos, "restaurar clasificacion", persistencia de
   `necesidades` manuales y el historial `CLASIFICACION`.
2. **Se rehace sobre `master`**, portando a mano lo aprovechable de `78b0bef`. No se mergea esa rama.
3. **El Radar no toca catalogo, inventario, altas ni identidades SKU.** Solo lee y agrupa.
4. **La marca se conserva tal como la pidio el cliente**, aunque no exista en ningun catalogo.
5. Jerarquia objetivo: **Familia -> Tipo -> Marca -> Modelo**.
6. Numero que Victor quiere ver: *"Guitarras: 14 pedidas, 9 electroacusticas; marcas: Yamaha 5,
   Fender 3, sin marca 6"*.

## Hallazgos ya verificados que el diseno debe resolver

- **Marcas perdidas:** `backend/radar/familias.js:32` (en `78b0bef`) tiene una lista cerrada de 15
  marcas; Ibanez/Epiphone/Takamine/Casio/Roland desaparecen del desglose cuando vienen dentro del
  texto libre. Una `marca_solicitada` capturada en su campo si se conserva. Hay que distinguir
  **"marca no informada"** de **"marca no identificada"**, y no esconder la segunda dentro de
  "sin marca".
- **Una demanda corrupta tumba la pantalla:** validacion estricta sobre datos ya guardados
  (`familias.js:38-49`) que sale como HTTP 400 en `server.js:657` y deja sin Analisis ni Inteligencia
  a todos. El diseno debe **degradar el renglon a "Por clasificar" con motivo visible**, nunca tirar
  la consulta completa.
- **Cuenta como pendiente lo ya vendido:** `familias.js:84` excluye solo `CANCELADA`, asi que las
  `CONVERTIDA` (ya vendidas) y hasta estados desconocidos cuentan como demanda vigente. Existe
  `ESTADOS_PENDIENTES` en `backend/radar/metricas.js:11`. Separa **demanda historica** de
  **oportunidad pendiente**.
- **Unidades mezcladas:** hoy familia cuenta solicitudes, `cantidad` suma unidades y tipos/marcas
  cuentan presencia por solicitud. No son intercambiables. Define **una sola unidad de conteo por
  cifra**, y que el ejemplo de Victor (14 / 9 / 5+3+6) cuadre: mismas unidades, mismo periodo, mismo
  universo de estados; las solicitudes unicas se muestran aparte. Las cantidades ambiguas quedan
  pendientes: no se reparten ni se cuentan como 1.
- **`identidad.js` (ya en master) se reutiliza por piezas, NO reemplazando `normalizar()` por su bolsa
  de palabras.** Esa bolsa ordena las palabras y elimina "para", "con", "y": confundiria "pastilla
  para guitarra" con "guitarra con pastilla". Extrae sus primitivas (acentos, plurales, unidades,
  tolerancia a erratas por distancia de edicion) conservando orden y relaciones.
- **Nunca se midio contra datos reales.** El QA anterior era sintetico.

## Lo que deben contener los documentos

**Spec (diseno):**
- Que ve Victor en pantalla y que decision de compra toma con cada cifra.
- El modelo: que se guarda como evidencia (texto original, marca/modelo explicitos, cantidad, fecha,
  sucursal, estado) y que se **deriva al consultar** (familia, tipo, marca, modelo, regla aplicada,
  version de reglas). Identificadores estables separados de las etiquetas con acentos.
- Como se define una familia y como se agrega una nueva regla sin migrar datos.
- Reglas de conteo, explicitas, con el ejemplo de las 14 guitarras resuelto paso a paso.
- Que pasa con lo que no se reconoce ("Por clasificar": texto, motivo, frecuencia).
- Que NO hace el modulo.

**Plan (ejecucion):**
- Tasks pequenas, secuenciales donde deban serlo, cada una con archivos autorizados y prohibidos.
- Cada task con su prueba primero (TDD) y criterio de aceptacion verificable.
- Una task explicita de **medicion sobre una copia de produccion en solo lectura**: % sin familia, %
  sin tipo, % con marca no identificada, ejemplos frecuentes y agrupaciones incorrectas. El umbral de
  cobertura aceptable se fija DESPUES de esa medicion, no antes.
- Pruebas obligatorias: texto corrupto sin caida global, las seis marcas que hoy se pierden,
  cantidades ambiguas, estados terminales, filtros iguales en ambos periodos, rechazo de cualquier
  override manual, y ausencia de escrituras a catalogo/inventario.
- Que piezas de `78b0bef` se portan y cuales se descartan, archivo por archivo.

## Reglas duras

- Sin dependencias nuevas.
- Sin acentos rotos: los documentos van en espanol correcto, UTF-8.
- Si encuentras una decision de negocio que no esta escrita aqui, **detente y reportala** en vez de
  inventarla.
- Los documentos son para Victor, que no programa: la parte de "que ve y que decide" en lenguaje de
  negocio; los detalles tecnicos van despues, separados.

## Entrega

Escribe los dos archivos y responde con: ruta de cada uno, el resumen de una linea de cada task del
plan, y la lista de decisiones que te faltaron.
