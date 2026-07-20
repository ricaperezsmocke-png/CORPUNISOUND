# Buscador de producto por fila + sugerencia automática — Design Spec

## Contexto

`RecepcionCompras.jsx` tiene dos flujos de importación asistida que arman una tabla de renglones detectados (uno por Importar XML, otro por Escanear Factura IA), y en ambos cada renglón necesita que el usuario vincule manualmente esa línea con un producto de su catálogo antes de poder confirmarla. Hoy ese vínculo se hace con un `<select>` que lista **todos** los productos del catálogo — con cientos de productos, buscar el correcto a mano por scroll es lento.

Victor probó el flujo de Escanear Factura IA en producción y pidió: reemplazar ese `<select>` por un buscador de texto (como el que ya existe en el modal "Buscar producto" F2), y que el sistema sugiera automáticamente a qué producto corresponde cada línea, ya sea por código o por descripción.

## Objetivo

1. La IA (`facturaIA.js`) también intenta leer un código/clave de línea si el documento lo trae, además de lo que ya lee hoy.
2. Cada renglón detectado (en los dos modales: IA y XML) llega precargado con una sugerencia de producto cuando el sistema encuentra una coincidencia razonable por código o por descripción — marcada visualmente como "Sugerido", igual que ya ocurre hoy solo en XML por Clave SAT.
3. El `<select>` de lista completa se reemplaza, en los dos modales, por un cuadro de texto por fila que filtra el catálogo mientras se escribe (clave, código de barras o nombre) y muestra hasta 8 coincidencias para elegir con un clic.
4. Nada de esto cambia la regla ya existente: la sugerencia solo precarga el campo — la casilla "Confirmar" de cada línea sigue siendo manual, nunca se marca sola.

## Fuera de alcance

- La compuerta de legibilidad de `facturaIA.js` no cambia.
- No se toca el modal completo "Buscar producto" (F2) que se usa para agregar productos manualmente fuera de estos dos flujos — sigue como está.
- No se agrega ninguna dependencia nueva de fuzzy-search; el matching de texto es JS plano.
- No se auto-confirma ninguna línea ni se crean productos nuevos para líneas sin match — igual que hoy.

## Diseño

### 1. Backend — `facturaIA.js`: leer código de línea

`TOOL_EXTRAER_FACTURA.input_schema.properties.conceptos.items.properties` gana un campo nuevo, opcional:

```js
codigo: {
  type: ["string", "null"],
  description: "Código, clave o SKU que aparezca impreso junto a esta línea en el documento, tal como está escrito. Usa null si el documento no muestra ningún código para esa línea — no inventes uno.",
}
```

No es `required` (a diferencia de `descripcion`/`cantidad`/`costo_unitario`/`aplica_iva`, que ya lo son) — muchas notas de remisión no traen código de línea. El prompt de texto que acompaña la llamada a Claude se actualiza para mencionar este campo nuevo junto a los demás.

`analizarFacturaImagen` no cambia su lógica — el campo nuevo simplemente viaja dentro de cada `input.conceptos[i]` igual que los demás, y el backend lo devuelve tal cual al frontend (no se valida ni se usa server-side).

### 2. Frontend — helper de sugerencia compartido

Nueva función en `src/RecepcionCompras.jsx` (o extraída a un módulo pequeño si el archivo ya está muy cargado — decisión de implementación, no cambia el comportamiento):

```
sugerirProducto(concepto, productos) → { producto_id, porSugerencia: "codigo" | "descripcion" } | null
```

Orden de intento:

1. **Por código:** si `concepto.codigo` existe, compara (normalizado: minúsculas, sin espacios extra) contra `producto.sku`, `producto.codigo` (código de barras) de cada producto — y, solo cuando el concepto viene del flujo XML, también contra `producto.clave_sat` (mismo comportamiento que ya existe hoy para XML, ahora expresado dentro del helper compartido en vez de duplicado). Primer match exacto gana.
2. **Por descripción:** si no hubo match por código, normaliza `concepto.descripcion` y `producto.nombre` (minúsculas, sin acentos, dividido en palabras) y calcula un puntaje = palabras en común ÷ palabras de la descripción leída. Sugiere el producto de mayor puntaje, solo si comparte al menos una palabra significativa (se ignoran palabras de 1-2 letras como "de", "un"). Sin coincidencia razonable → sin sugerencia.

Este helper reemplaza la lógica de sugerencia que hoy vive inline dentro de `leerArchivoXml` (líneas ~151-159 actuales, matching solo por `clave_sat`) y se reutiliza también en `leerArchivoFacturaImagen`. Comportamiento observable para XML no cambia (sigue sugiriendo por Clave SAT primero) — gana además la sugerencia por descripción como respaldo cuando la Clave SAT no matchea, y por código de barras/SKU si el CFDI trae uno reconocible.

### 3. Frontend — componente de buscador por fila

Nuevo componente pequeño, usado en las dos tablas de confirmación (IA y XML) en vez del `<select>` actual:

```
<BuscadorProductoFila
  productos={productos}
  productoIdSeleccionado={matches[idx]}
  onSeleccionar={(producto_id) => ...}
/>
```

- Input de texto que muestra el nombre del producto ya seleccionado (o vacío si no hay ninguno).
- Al enfocar o escribir, muestra debajo una lista de hasta 8 productos cuyo `nombre`, `sku` o `codigo` contiene el texto (mismo criterio de filtro que ya usa `productosFiltrados` en el modal F2, sin los filtros de departamento/categoría — aquí no hacen falta porque es una lista corta por fila).
- Clic en una fila de la lista → selecciona ese producto, cierra la lista, actualiza `matches[idx]`.
- Borrar el texto → `producto_id` vuelve a `null`, la línea queda "Sin vincular — se ignora" (mismo texto/comportamiento que hoy).
- Reemplaza el `<select>` en ambas tablas (`RecepcionCompras.jsx` línea ~796 del modal XML y ~870 del modal IA, según numeración actual en `master` tras el merge de Escanear Factura IA).

### 4. Integración de la sugerencia en los dos flujos

- **IA:** al recibir la respuesta de `/api/compras/importar-ia`, además de `setIaParseado(data)`, se corre `sugerirProducto` por cada concepto y se llenan `matchesIa`/`sugeridosIa` (mismo patrón de estado que XML ya tiene hoy con `matchesXml`/`sugeridosXml`).
- **XML:** `leerArchivoXml` cambia su bloque actual de sugerencia (líneas ~151-159) para llamar al helper compartido en vez de repetir la lógica de match por Clave SAT inline.
- La etiqueta ámbar "Sugerido" que ya existe en la tabla XML se muestra también en la tabla IA cuando `sugeridosIa[idx]` es verdadero.

## Testing

- `backend/facturaIA.test.js`: agregar un caso que confirme que un `codigo` presente en la respuesta de Claude se propaga en `conceptos[i].codigo`, y que `TOOL_EXTRAER_FACTURA` no marca `codigo` como `required`.
- Frontend: sin arnés de pruebas automatizado en este proyecto (convención ya establecida) — verificación manual por Victor con una factura real, cubriendo: sugerencia por código cuando el documento trae uno reconocible, sugerencia por descripción cuando no, y que escribir en el buscador de una fila la reemplaza correctamente.
- `cd backend && npm test` debe seguir en verde (273+ pruebas) antes de mergear.
