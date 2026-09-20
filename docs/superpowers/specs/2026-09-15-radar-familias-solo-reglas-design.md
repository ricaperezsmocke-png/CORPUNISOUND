# Radar de Demanda: Familia → Tipo → Marca → Modelo, SOLO REGLAS

**Fecha:** 2026-09-15.
**Estado:** incorpora las decisiones expresas de Victor; el diseño técnico siguiente es la propuesta para implementarlas.
**Autoría:** redactado por Codex bajo el contrato `docs/superpowers/despachos/2026-09-15-radar-familias-spec.md`; escrito a disco por Claude.

## 1. Objetivo y autoridad

El Radar debe responder qué necesita comprar la tienda, reuniendo demandas de una misma familia aunque cambien marca, modelo o características.

Las decisiones de Victor del 2026-09-15 prevalecen sobre el documento `2026-09-11-radar-familias-design.md`. La afirmación de aquel documento sobre una aprobación para permitir correcciones manuales carece de evidencia verificable.

Contratos obligatorios:

- El Radar solo lee y cuenta para producir esta clasificación. No modifica catálogo, inventario, productos ni altas.
- Nadie junta, separa ni reclasifica demandas manualmente.
- Una agrupación incorrecta se corrige mediante una regla general; después se recalcula todo el historial aplicable.
- No existen excepciones por ID de demanda.
- Los textos originales se conservan.
- No se incorporan dependencias nuevas.

La captura y el seguimiento existentes de demandas continúan siendo funciones separadas. Esta capa no agrega escrituras a esos procesos.

## 2. Universos de demanda

| Nombre obligatorio | Contenido | Uso |
|---|---|---|
| **PENDIENTE** | Estados incluidos en `ESTADOS_PENDIENTES`, de `backend/radar/metricas.js` | Oportunidad viva; única demanda que alimenta la sugerencia de compra |
| **HISTÓRICA** | PENDIENTE + `CONVERTIDA` + `NO_CONVERTIDA` | Tendencia de "qué me piden", vendido o no |
| **DESCARTADA** | `CANCELADA` | Fuera de todo conteo; visible únicamente en su expediente |

**Precisión matemática:** PENDIENTE e HISTÓRICA no son conjuntos disjuntos: HISTÓRICA contiene PENDIENTE. Se conservan las definiciones de Victor y nunca se suman ambos totales. Los estados subyacentes —pendientes, convertidas y canceladas— sí son categorías separadas.

Una `CANCELADA` no participa en:

- Solicitudes, unidades, tipos, marcas, modelos ni características.
- Tendencias, periodos anteriores o porcentajes.
- Sucursales, contactos, motivos, rankings o señales de compra derivados de demanda.
- Listados de evidencia agregada ni contadores de calidad de esta capa.

El acceso a su expediente individual conserva la evidencia y su historial.

Un estado vacío o desconocido se reporta como **estado no clasificable**. No entra en PENDIENTE ni HISTÓRICA; no se reemplaza por `REGISTRADA`.

**Decisión de Victor, 2026-09-15:** `NO_CONVERTIDA` ("No se concretó") **entra en HISTÓRICA**, no en PENDIENTE. Razón: se lo pidieron y no se lo vendió; esa es la venta que se le fue, y es señal de compra tan válida como una convertida. No se renombra como CANCELADA ni como estado desconocido, y esto no redefine por sí mismo las métricas operativas de conversión existentes de `backend/radar/metricas.js`.

Dentro de las no convertidas debe mostrarse el desglose por motivo (`Cliente compró en otro lugar`, `Precio`, `Tiempo de entrega`, `No respondió`, `Perdió interés`, `Otro`), para distinguir la venta perdida por no tener el producto de la que se cayó por otra causa. Ese desglose es informativo y no altera los totales.

El universo, periodo y alcance de sucursal deben figurar en cada presentación de demanda. La tendencia compara HISTÓRICA con HISTÓRICA, usando filtros equivalentes.

## 3. Taxonomía

La jerarquía es:

**Familia → Tipo → Marca → Modelo**

Ejemplo: **Guitarras → Electroacústica → Yamaha → modelo informado**.

**Regla de Victor:** el TIPO es lo mínimo que cambia qué producto sales a comprar. Número de cuerdas, color, tamaño, zurdo y acabado son CARACTERÍSTICAS.

Por tanto:

- Electroacústica es tipo.
- "12 cuerdas" es característica.
- Una electroacústica de 12 cuerdas no crea un tipo adicional.
- Las características se desglosan dentro del tipo: "De esas 9 electroacústicas, 2 son de 12 cuerdas".
- Cada artículo interpretado tiene una sola familia y un solo tipo, incluido "Tipo no identificado".
- Las características pueden coexistir; sus conteos no se suman entre sí como particiones del total.

Los tipos deben sumar las unidades conocidas de la familia, incluyendo el grupo de tipo no identificado.

Los identificadores internos son estables y no dependen de etiquetas acentuadas. Cambiar una etiqueta visible no invalida el historial.

## 4. Normalización y reglas

Se reutiliza `backend/radar/identidad.js` de master como fuente de normalización y tolerancia a erratas. No se mantiene otro `normalizar()` independiente en `familias.js`.

El código actual de identidad:

- Normaliza acentos, mayúsculas y unidades.
- Simplifica plurales.
- Compara palabras tolerando ciertas erratas.
- Produce una bolsa ordenada que pierde el orden y elimina conectores.

Por eso la implementación debe compartir sus primitivas sin pasar la bolsa ordenada directamente al clasificador semántico.

Secuencia:

1. Leer campos originales sin modificarlos.
2. Obtener una representación normalizada que conserve posiciones, orden y conectores relevantes.
3. Separar artículos únicamente cuando una regla lo justifique.
4. Identificar el artículo principal y distinguir instrumentos, accesorios y servicios.
5. Asignar familia y tipo.
6. Extraer características, marca y modelo con evidencia.
7. Agregar según universo y cantidades conocidas.

La tolerancia a erratas se aplica a vocabulario controlado de artículos/tipos, con reglas y exclusiones verificables. No se usa para fusionar automáticamente marcas o modelos parecidos.

Deben permanecer diferentes:

- "Pastilla para guitarra" y "guitarra con pastilla".
- "Reparación de guitarra" y "guitarra".
- "Cable Y de audio" y una solicitud real de varios artículos.

## 5. Marcas abiertas y conservación literal

La lista de 15 marcas no es una condición para conservar o identificar una marca. Puede servir como diccionario auxiliar, nunca como límite de admisión.

Se distinguen tres estados visibles:

| Estado | Significado |
|---|---|
| **Marca no informada** | No hay evidencia de una marca en los campos o texto |
| **Marca no identificada** | Hay un fragmento candidato o ambiguo que no puede atribuirse con seguridad a una marca |
| **Marca reconocida** | Un campo explícito o una regla identifica la marca, aunque no exista en ningún diccionario |

Una marca reconocida conserva exactamente la escritura del vendedor. Una clave normalizada separada permite agrupar equivalencias aprobadas sin reemplazar la evidencia original.

Reglas de extracción:

- `marca_solicitada` explícita admite marcas desconocidas.
- Expresiones inequívocas, como "marca X", permiten extraer X sin conocerla previamente.
- Una marca conocida puede reconocerse dentro de texto libre.
- Un fragmento ambiguo se conserva literalmente como candidato, junto con el texto completo, bajo "Marca no identificada".
- El sistema no convierte descriptores como "económica" en marcas por simple descarte.
- No se confunde presupuesto, modelo o característica con marca.

**Garantía:** ninguna marca desconocida desaparece por estar fuera del diccionario. Si no puede separarse con seguridad, su evidencia permanece visible. Conservarla no significa fingir que el sistema pudo reconocer su función.

Pruebas obligatorias: Ibanez, Epiphone, Takamine, Casio, Roland y una marca inventada generada durante la prueba, ausente de las reglas. Se cubren campo explícito, texto con "marca", texto sin marcador y ambigüedad. No existe requisito de una sexta marca real.

## 6. Qué se guarda y qué se infiere

Se conservan los datos fuente existentes: descripción, marca/modelo capturados, variante, cantidad, estado, sucursal y fechas.

Se calculan al leer:

- Artículos interpretados.
- Familia, tipo y características.
- Marca/modelo identificados y candidatos ambiguos.
- Cantidad atribuible a cada artículo.
- Regla y versión utilizadas.
- Motivos de incertidumbre.

Esta capa no persiste `necesidades`, overrides ni historial de reclasificación. Si hubiera clasificaciones manuales previamente guardadas, no gobiernan el resultado; tampoco se borran silenciosamente.

Modificar reglas produce una reclasificación uniforme en la siguiente consulta. Ningún GET reescribe los registros.

## 7. Conteos y ejemplo contractual

Se muestran separadamente:

- **Solicitudes:** demandas únicas dentro del grupo.
- **Unidades conocidas:** suma de cantidades atribuibles a artículos.
- **Artículos con cantidad desconocida:** no se convierten en cero unidades solicitadas ni en una unidad supuesta.

Una demanda con dos artículos de Guitarras cuenta una solicitud en esa familia, pero suma las cantidades conocidas de ambos artículos. Por eso los desgloses aditivos de tipos y marcas usan unidades, no presencia por solicitud.

Para un mismo universo, periodo y sucursal:

> **Guitarras: 14 unidades pedidas.**
> **9 electroacústicas**, de las cuales **2 son de 12 cuerdas**.
> **Marcas:** Yamaha 5, Fender 3, marca no informada 6.

Condiciones:

- Las otras 5 unidades pertenecen a otros tipos o a "Tipo no identificado".
- Los subtotales de marca suman 14.
- Las 2 de 12 cuerdas ya están incluidas en las 9 electroacústicas.
- Si existen marcas no identificadas, aparecen en su propia categoría; no se incluyen en "Marca no informada".
- Las cantidades desconocidas se muestran aparte.
- Las marcas de toda la familia se obtienen sumando los tipos, con el mismo universo.

No se reparte una cantidad general entre varios artículos por conjetura. Tampoco se sobrescribe `demanda.cantidad` con la suma de familias distintas.

## 8. "Por clasificar" y tolerancia a datos defectuosos

Un fallo de interpretación afecta únicamente al artículo correspondiente.

- Familia desconocida: "Por clasificar".
- Familia conocida y tipo desconocido: conserva familia.
- Marca ambigua: conserva familia y tipo; muestra "Marca no identificada".
- Estado desconocido: excluye de universos comerciales y reporta el problema.
- Datos dañados: conserva texto y motivo; nunca aborta todo Análisis o Inteligencia.

La evidencia de "Por clasificar" sirve para mejorar reglas generales. No ofrece acciones manuales de agrupación.

Los diagnósticos respetan sucursal y permisos. No incluyen demandas CANCELADA.

## 9. Interfaz y API

Análisis e Inteligencia ofrecen la jerarquía desplegable y la evidencia original.

- PENDIENTE alimenta señales de compra.
- HISTÓRICA permite revisar tendencia y conversiones.
- Características se muestran dentro del tipo.
- Las tres situaciones de marca tienen etiquetas distintas.
- El expediente de una convertida puede mostrar su venta vinculada; no se inventa esa vinculación si falta.
- No hay editor de clasificación, botón de juntar/separar ni restauración manual.
- POST/PATCH de demanda no aceptan overrides de clasificación.
- Los PATCH operativos existentes conservan su función.
- No se agrega `/clasificar` para sostener un editor eliminado.

## 10. Validación real y condición de entrega

**BLOQUEADA: medición con demandas reales.**

Estado verificado el 2026-09-15:

- El checkout principal tiene cero productos y cero demandas.
- La copia del worktree de Radar está vacía.
- Las demandas reales están en producción.

La tarea queda bloqueada hasta que Victor abra su sesión de producción.

Será una consulta **exclusivamente de lectura, sin escribir nada en producción**: sin migraciones, normalizaciones persistidas, reparaciones, altas ni reclasificaciones guardadas.

Medirá cobertura de familia/tipo, marcas no identificadas, cantidades desconocidas, estados inválidos y errores de agrupación, con denominadores explícitos y sin CANCELADA.

Una base vacía no acredita cobertura ni equivale a 0 % de errores. La implementación no se declara validada para datos reales ni lista para integrar hasta completar esta medición y la revisión independiente.
