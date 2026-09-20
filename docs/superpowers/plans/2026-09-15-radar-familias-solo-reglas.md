# Plan de implementación: Radar por familias, SOLO REGLAS

> **Para ejecución futura:** usar `superpowers:executing-plans` y completar las tareas con sus verificaciones. Este documento no autoriza implementar, levantar servidores ni modificar producción.

**Autoría:** redactado por Codex bajo el contrato `docs/superpowers/despachos/2026-09-15-radar-familias-spec.md`; escrito a disco por Claude.

**Objetivo:** agrupar demanda en Familia → Tipo → Marca → Modelo, conservando evidencia y excluyendo edición manual.

**Arquitectura:** proyección calculada al consultar sobre master. Normalización compartida con `identidad.js`, selección explícita de universos y un agregador común para Análisis e Inteligencia.

**Tecnologías:** Node.js, runner `node:test`, React y dependencias existentes.

**Spec:** `docs/superpowers/specs/2026-09-15-radar-familias-solo-reglas-design.md`.

## Restricciones globales

- No escribir catálogo, inventario, productos ni altas.
- No persistir clasificación ni permitir excepciones manuales.
- Excluir CANCELADA de todo conteo y evidencia agregada.
- Estados desconocidos no son demanda viva.
- HISTÓRICA contiene PENDIENTE; sus totales no se suman.
- "12 cuerdas" es característica, nunca tipo.
- Conservar texto literal de marcas aunque sean desconocidas.
- Sin dependencias nuevas.
- No publicar, hacer push, merge o rebase; la integración corresponde a Victor.
- La medición de producción está bloqueada hasta que Victor abra su sesión y será de solo lectura.

## Base y archivos

Partir de master actualizado al momento de ejecutar, en un worktree de implementación autorizado. No aplicar íntegro `78b0bef`.

La revisión encontró 34 commits de master ausentes en la rama de familias y cambios posteriores en archivos compartidos. Se reutilizarán selectivamente reglas, presentación y pruebas compatibles; no captura manual ni persistencia de `necesidades`.

| Archivo | Responsabilidad |
|---|---|
| `backend/radar/identidad.js` | Primitivas compartidas de normalización |
| `backend/radar/metricas.js` | Estados pendientes y selección coherente de universos |
| `backend/radar/familias.js` — nuevo sobre master | Interpretación y agregación pura |
| `backend/radarDemanda.js` | Integración en consultas y protección contra overrides |
| `backend/radarDemandaInteligencia.js` | Evidencia de demanda conforme al universo |
| `backend/server.js` | Exposición de consultas existentes |
| `src/radar-demanda/FamiliasDemanda.jsx` — nuevo sobre master | Jerarquía y evidencia |
| `src/radar-demanda/AnalisisDemanda.jsx` | Vista histórica y filtros |
| `src/radar-demanda/InteligenciaCompras.jsx` | Vista pendiente para compras |
| Pruebas de identidad, métricas, familias, integración y rutas | Contratos y regresiones |

No portar `ClasificacionDemanda.jsx` ni sus inserciones en Registro/Detalle.

## Tarea 1. Centralizar universos y exclusión de canceladas

**Archivos:** `backend/radar/metricas.js`, `backend/radarMetricas.test.js`.

**Interfaz propuesta:** `clasificarEstadoDemanda(estado)` devuelve `PENDIENTE`, `CONVERTIDA`, `DESCARTADA`, `NO_CONVERTIDA` o `NO_CLASIFICABLE`. La pertenencia a HISTÓRICA se deriva únicamente de las dos primeras categorías.

- [ ] Escribir casos para cada estado pendiente, CONVERTIDA, CANCELADA, NO_CONVERTIDA, vacío y desconocido.
- [ ] Comprobar que las pruebas nuevas fallan antes de implementar.
- [ ] Implementar usando `ESTADOS_PENDIENTES`, sin una segunda lista de estados vivos.
- [ ] Probar que añadir cualquier número de CANCELADA deja idénticos los resultados agregados de demanda.
- [ ] Separar los contratos de demanda de las métricas operativas de conversión; no redefinir silenciosamente estas últimas.
- [ ] Ejecutar `node --test backend/radarMetricas.test.js`.

**Salida verificable:** las canceladas no aportan cifras; los estados inválidos producen diagnóstico y nunca pendientes.

## Tarea 2. Compartir normalización sin perder significado

**Archivos:** `backend/radar/identidad.js`, `backend/radar/identidad.test.js`.

**Interfaz propuesta:** `normalizarTextoRadar(texto)` produce una representación normalizada conservando orden; `crearBolsaPalabras` continúa ofreciendo su contrato existente.

- [ ] Añadir pruebas de acentos, mayúsculas, plurales, medidas y conservación de conectores.
- [ ] Añadir regresiones de `crearBolsaPalabras` y agrupación difusa.
- [ ] Extraer las primitivas comunes y comprobar que el comportamiento existente no cambia.
- [ ] Preparar reutilización de tolerancia a erratas para vocabulario controlado, sin aplicarla indiscriminadamente a marcas/modelos.
- [ ] Ejecutar `node --test backend/radar/identidad.test.js`.

**Salida verificable:** existe una sola fuente de normalización; "pastilla para guitarra" mantiene su relación semántica.

## Tarea 3. Clasificar artículos, tipos, características y marcas abiertas

**Archivos:** crear `backend/radar/familias.js` y `backend/radar/familias.test.js`.

**Interfaz propuesta:** `clasificarSolicitud(registro)` devuelve artículos interpretados con evidencia original, familia, tipo, características, marca, modelo, cantidad atribuible, regla, versión y diagnósticos.

- [ ] Escribir pruebas de guitarra electroacústica de 12 cuerdas: un tipo Electroacústica y una característica 12 cuerdas.
- [ ] Cubrir accesorios, servicios, artículo principal, "cable Y" y multiartículo.
- [ ] Cubrir Ibanez, Epiphone, Takamine, Casio y Roland en campo explícito y texto libre.
- [ ] Generar una marca inventada en tiempo de prueba y comprobar conservación literal, sin introducirla en el diccionario.
- [ ] Comprobar reconocimiento por "marca X" y conservación de candidatos ambiguos como marca no identificada.
- [ ] Cubrir "guitarra económica", importes y modelos para evitar falsas marcas.
- [ ] Comprobar que `necesidades` manuales guardadas no cambian la clasificación.
- [ ] Implementar reglas puras con claves estables y normalización compartida.
- [ ] Ejecutar `node --test backend/radar/familias.test.js`.

**Salida verificable:** una marca desconocida no desaparece; ambigüedad no equivale a ausencia.

## Tarea 4. Agregar cantidades y jerarquía sin duplicar

**Archivos:** `backend/radar/familias.js`, `backend/radar/familias.test.js`.

**Interfaz propuesta:** `agruparFamilias(registros, opciones)` recibe universo explícito y devuelve solicitudes únicas, unidades conocidas, artículos de cantidad desconocida, jerarquía y diagnósticos.

- [ ] Construir un fixture con 14 unidades: 9 electroacústicas, 2 de ellas de 12 cuerdas; Yamaha 5, Fender 3 y marca no informada 6.
- [ ] Exigir que los tipos sumen 14 y que las características no incrementen ese total.
- [ ] Añadir un caso con marca no identificada y verificar que no se mezcla con marca no informada.
- [ ] Cubrir dos artículos de la misma familia en una solicitud.
- [ ] Cubrir cantidades parciales y multiartículo sin reparto supuesto.
- [ ] Añadir convertidas y canceladas: solo las convertidas aumentan HISTÓRICA; ninguna aumenta PENDIENTE.
- [ ] Verificar inmutabilidad de los registros antes/después.
- [ ] Ejecutar las pruebas de familias.

**Salida verificable:** cada cifra tiene unidad y universo definidos; solicitudes y unidades no se confunden.

## Tarea 5. Integrar consultas y tolerar historial defectuoso

**Archivos:** `backend/radarDemanda.js`, `backend/radarDemandaInteligencia.js`, `backend/server.js`; pruebas de análisis, inteligencia e integración.

- [ ] Añadir casos donde un artículo defectuoso convive con registros válidos: la consulta debe continuar.
- [ ] Aplicar la selección de universo antes de todos los agregados de demanda, no únicamente al panel nuevo.
- [ ] Revisar totales, rankings, motivos, sucursales, contactos, fechas y señales para evitar contribuciones de CANCELADA.
- [ ] Usar filtros equivalentes en el periodo actual y anterior, con `America/Mexico_City`.
- [ ] Mantener permisos y aislamiento por sucursal en resultados y diagnósticos.
- [ ] Hacer que las señales de compra consuman exclusivamente PENDIENTE.
- [ ] Rechazar `necesidades` y otros overrides de clasificación en POST/PATCH; comprobar también el POST, que podría ignorar campos desconocidos.
- [ ] No incorporar la ruta de sugerencia ni historial `CLASIFICACION`.
- [ ] Probar que las consultas no cambian DB, catálogo, inventario, demandas ni historial.

**Comandos previstos:**

```
node --test backend/radarDemandaAnalisis.test.js backend/radarDemandaInteligencia.test.js
node --test backend/radarFamiliasIntegracion.test.js backend/radarFamiliasRutas.test.js
node --test backend/radarDemandaInteligenciaRutas.test.js
```

Las pruebas de rutas se ejecutarán en entorno sintético autorizado; no contra producción.

**Salida verificable:** ningún registro defectuoso tumba el reporte y ninguna vía de escritura permite clasificar manualmente.

## Tarea 6. Presentar la jerarquía y sus universos

**Archivos:** `FamiliasDemanda.jsx`, `AnalisisDemanda.jsx`, `InteligenciaCompras.jsx`.

- [ ] Mostrar Familia → Tipo → Marca → Modelo.
- [ ] Mostrar características dentro del tipo.
- [ ] Rotular universo, periodo, solicitudes y unidades.
- [ ] Presentar por separado marca reconocida, marca no informada y marca no identificada.
- [ ] Conservar escritura original y fragmentos ambiguos en el detalle.
- [ ] Ofrecer evidencia de "Por clasificar" sin botones de corrección.
- [ ] Mantener las canceladas exclusivamente accesibles por su expediente individual.
- [ ] Verificar con el fixture 14/9/2/5/3/6 en escritorio y móvil.
- [ ] Verificar ausencia de editores, acciones de juntar/separar y envíos de overrides.
- [ ] Ejecutar build y lint mediante los scripts vigentes del proyecto.

**Salida verificable:** Victor puede comprobar de dónde sale cada número sin confundir variantes con tipos ni históricos con pendientes.

## Tarea 7. Medir demandas reales — BLOQUEADA

**Bloqueo:** Victor debe abrir su sesión de producción. Las bases locales disponibles están vacías y no sirven para medir cobertura.

**Modalidad obligatoria:** lectura, sin escribir nada en producción. No ejecutar allí rutas de mutación, migraciones, reparaciones ni normalizaciones persistidas.

- [ ] Confirmar sesión abierta y acceso al conjunto de datos autorizado.
- [ ] Usar una consulta o extracción de lectura; procesar en memoria sin modificar el origen.
- [ ] Si se utiliza una copia, comprobar que representa las demandas reales y registrar su fecha de corte.
- [ ] Excluir CANCELADA antes de cualquier conteo o muestra.
- [ ] Medir solicitudes elegibles y artículos interpretados con denominadores separados.
- [ ] Medir familia/tipo no identificados, los tres estados de marca, cantidades desconocidas y estados no clasificables.
- [ ] Revisar muestras de agrupaciones correctas e incorrectas, incluidas marcas nuevas y multiartículo.
- [ ] Informar periodo, alcance, versión de reglas, tamaño de muestra y limitaciones; evitar datos personales innecesarios.
- [ ] Convertir los errores comprobados en reglas generales y pruebas de regresión; repetir la medición.
- [ ] Entregar evidencia al propietario para evaluar cobertura.

**No satisface esta tarea:** ejecutar ejemplos sintéticos, consultar una base vacía o declarar 0 % de errores sin denominador.

**Salida:** informe de cobertura real. Hasta entonces, esta tarea y la validación de producción permanecen bloqueadas.

## Tarea 8. Revisión independiente y entrega

- [ ] Ejecutar la suite de Radar y después los controles generales exigidos por el repositorio.
- [ ] Verificar en navegador los recorridos sintéticos, sin usar producción para escrituras.
- [ ] Obtener revisión independiente conforme a `CLAUDE.md`; no presentar la revisión del implementador como validación independiente.
- [ ] Resolver hallazgos y repetir únicamente las verificaciones afectadas.
- [ ] Comprobar correspondencia entre spec, pruebas, interfaz y medición real.
- [ ] Entregar a Victor cambios, resultados, limitaciones y estado de cada tarea.
- [ ] Dejar integración y publicación a cargo de Victor.

**Condición de cierre:** pruebas y revisión satisfactorias, contrato SOLO REGLAS cumplido y tarea 7 completada. Si la sesión de producción sigue cerrada, se informa "implementación verificada con datos sintéticos; validación real bloqueada", sin declarar el trabajo listo para integrar.

## Decisión de Victor sobre `NO_CONVERTIDA` (2026-09-15)

`NO_CONVERTIDA` ("No se concretó") **SÍ cuenta en HISTÓRICA**, junto con PENDIENTE y CONVERTIDA. Razón del dueño: se lo pidieron y no se lo vendió; esa es justamente la venta que se le fue.

Queda entonces:

- **PENDIENTE** = `ESTADOS_PENDIENTES`. Única fuente de la sugerencia de compra.
- **HISTÓRICA** = PENDIENTE + `CONVERTIDA` + `NO_CONVERTIDA`. Tendencia de "qué me piden".
- **DESCARTADA** = `CANCELADA`. Fuera de todo conteo.
- Estado vacío o desconocido: no clasificable, fuera de ambos, se reporta.

Además, el motivo de no conversión (`Cliente compró en otro lugar`, `Precio`, `Tiempo de entrega`, `No respondió`, `Perdió interés`, `Otro`) debe mostrarse desglosado dentro de las no convertidas, para distinguir la venta perdida por no tener el producto de la que se cayó por otra causa. Ese desglose es informativo: no cambia los totales.
