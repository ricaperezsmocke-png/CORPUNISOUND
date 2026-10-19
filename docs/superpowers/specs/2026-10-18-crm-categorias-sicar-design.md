# CRM: departamento y categoría de lo que compra, desde SICAR

Fecha: 2026-10-18. Base: master `6ae15bb` (Entrega 3 en producción). Rama `feature/crm-categorias-sicar`,
worktree `.claude/worktrees/crm-categorias-sicar`.

## 1. Para qué

La Entrega 3 puso en la ficha "qué compra" por categoría, pero en producción **el 100% sale "Sin categoría"**
(medido 2026-10-18 en los 50 primeros VIP de Ocosingo: $2,995,798, todo sin categoría). Causa: la categoría se
buscaba en el catálogo de CORPUNISOUND, que en producción tiene solo 6 productos. Las tiendas venden en SICAR y
el catálogo de verdad vive ahí.

Decisión de Victor (2026-10-18): **opción A** — el agente de cada tienda manda de SICAR el departamento y la
categoría de cada artículo; **la ficha agrupa por departamento y, dentro, por categoría**.

Éxito: la ficha de TEODOSIO GOMEZ SANTIZ muestra "Audio $1.2M → Bafles $800k, Amplificadores $400k" (cifras
ilustrativas) y casi nada en "Sin departamento"; las 10,919 ventas ya cargadas quedan clasificadas **sin volver a
cargarlas**.

## 2. Lo que ya existe y no se cambia

- `sicar_detalles` ya guarda `art_id` de cada renglón (`backend/sicarRepositorio.js`). Con eso basta para clasificar
  la historia.
- Contrato v1 (`docs/sicar-contrato-v1.md`, comprobado por `backend/sicarContrato.test.js`), ingesta en
  `backend/sicarIngesta.js`, secuencia, idempotencia, límites, códigos de respuesta: se conservan.
- Agente `agente-sicar/`: solo lectura forzada (`seguridad.js`), `mapeo.js` como único diccionario del esquema,
  `--verificar`, `--historico-ahora`, tarea cada 5 min. Nada de eso se relaja.
- VIP, cuentas internas, totales, `ajustes_centavos` y el cuadre de la Entrega 3: iguales.
- **No se crea ni modifica nada del catálogo, inventario, existencias, caja ni dinero de CORPUNISOUND.**

## 3. Decisiones tomadas (no reabrir)

1. Fuente de la clasificación de renglones SICAR: **SICAR**, vía el agente. El catálogo de CORPUNISOUND se usa solo
   para renglones del POS propio y como respaldo si SICAR no trae el artículo.
2. Agrupación: **departamento → categoría**.
3. Si el SICAR de una tienda no tiene las columnas esperadas, el agente **no se detiene**: sigue mandando clientes y
   ventas, anota `ARTICULOS_NO_DISPONIBLES` y la ficha sigue con "Sin departamento". No es dinero.

## 4. Diseño

### 4.1 Esquema SICAR supuesto (se confirma en Ocosingo)

`articulo(art_id, clave, descripcion, cat_id)`, `categoria(cat_id, nombre, dep_id)`,
`departamento(dep_id, nombre)`. **No está confirmado.** Va en `mapeo.js` como diccionario aparte
(`COLUMNAS_ARTICULOS`), validado aparte de las columnas obligatorias: si falta alguna, `articulosDisponibles = false`
y nada más falla. `--verificar` reporta qué columnas de esas tres tablas existen (solo nombres) y cuántos artículos
hay, para que Claude confirme o corrija los nombres con la PC de Ocosingo antes de activarlo.

Lectura (solo `SELECT`, pasa la guardia actual, una página por transacción READ ONLY):

```
SELECT a.art_id, a.clave, a.descripcion, c.nombre AS categoria, d.nombre AS departamento
FROM articulo a LEFT JOIN categoria c ON c.cat_id = a.cat_id LEFT JOIN departamento d ON d.dep_id = c.dep_id
WHERE a.art_id > ? ORDER BY a.art_id LIMIT ?
```

### 4.2 Contrato: colección opcional `articulos`

El sobre v1 acepta una colección nueva **opcional** `articulos` (sin cambiar `schema_version`; un lote sin ella es
idéntico al de hoy):

```json
"articulos": [ { "art_id": "10", "clave": "JLX215P", "descripcion": "BAFLE JLX ...",
                 "categoria": "Bafles", "departamento": "Audio" } ]
```

- `art_id` texto entero positivo (misma regla que hoy). `clave`, `categoria`, `departamento`: texto o `null`;
  `descripcion` texto. Recortados; vacío → `null`. Máximos: clave 100, descripcion 500 (iguales a los renglones de venta), categoria y departamento 100
  (si se pasan → 422 `TEXTO_INVALIDO` con `referencia`, el código que ya usa la ingesta). UTF-8 estricto, igual que el resto (`�` → rechazo).
- Límite: **500 artículos por lote** (422 `LIMITE_ENTIDADES`). El tope de 1 MiB sigue igual.
- Un lote puede traer solo `articulos` (clientes y ventas vacíos). Avanza la secuencia como cualquier lote.
- `art_id` repetido dentro del mismo lote → 422 `ID_DUPLICADO`.
- Se permiten en cualquier `mode`.
- El recibo cuenta `aceptados.articulos`.
- Se actualiza `docs/sicar-contrato-v1.md` (sección 2 y 4) y `backend/sicarContrato.test.js` a la par.

### 4.3 Servidor

- Tabla nueva `sicar_articulos(sucursal_id, art_id, clave, descripcion, categoria, departamento, actualizado_en,
  PRIMARY KEY(sucursal_id, art_id))`. Alta o reemplazo (upsert) por `(sucursal_id, art_id)`, dentro de la misma
  transacción del lote. La tienda sale de la llave, nunca del cuerpo (como hoy).
- Respaldo SICAR (`backend/sicarRespaldo.js`): la tabla entra en `TABLAS`; deben seguir restaurando las **tres
  generaciones anteriores** (10, 12 y 14 tablas). Sin tocar `backend/respaldos.js`.

### 4.4 Qué compra

`GET /api/crm/v2/clientes/:ref/que-compra` cambia `categorias` por `departamentos`:

```
{ departamentos: [ { nombre, monto_centavos, piezas,
                     categorias: [ { nombre, monto_centavos, piezas } ] } ],   // ambos de mayor a menor monto
  articulos, ajustes_centavos, total_centavos }
```

- Renglón SICAR: `sicar_articulos` por `(sucursal_id, art_id)` → `departamento`/`categoria`. Si no hay artículo o
  vienen nulos: buscar en el catálogo de CORPUNISOUND por clave→sku (lo de hoy) y usar su departamento y categoría.
  Si tampoco: "Sin departamento" / "Sin categoría".
- Renglón POS: departamento y categoría del producto del catálogo (`departamento_id`, `categoria_id`); sin producto →
  "Sin departamento" / "Sin categoría".
- Agrupar por **nombre normalizado** (sin acentos, sin mayúsculas, espacios simples) para que "AUDIO", "Audio" y el
  departamento del catálogo propio se sumen juntos; se muestra el primer nombre visto.
- Descripción de artículo SICAR: la de `sicar_articulos` si existe; si no, la del renglón (hoy).
- `ajustes_centavos = total_centavos − Σ departamentos.monto_centavos`. El cuadre sigue obligatorio: Σ categorías de
  un departamento = monto del departamento.

### 4.5 Agente

- `mapeo.js`: `COLUMNAS_ARTICULOS`, validación opcional, `articulos(cursor, limite)` y su reporte en `verificar()`.
- Cuándo manda: **una sincronización completa al día**, por páginas de 500 ordenadas por `art_id`, en la primera
  corrida dentro de 20:00–07:00 (misma ventana que el histórico), con cursor propio `articulos_cursor` y fecha
  `articulos_dia` en `estado.json`. Al llegar al final, se reinicia el cursor y se anota el día. Flag manual
  `--articulos-ahora` (como `--historico-ahora`) para la primera carga de día.
- Los lotes de artículos van solos (sin clientes ni ventas) y respetan las reglas de secuencia y reenvío idéntico de
  hoy. No compiten con el incremental: el incremental de ventas va primero en cada corrida.
- `ARTICULOS_NO_DISPONIBLES` se anota una vez por corrida en `agente-sicar.log`, sin detener nada.
- `LEEME.md` actualizado.

### 4.6 Pantalla

`src/CRMPerfilCompras.jsx`: departamentos con su monto y piezas, sus categorías debajo (sangría), y el renglón
"Ajustes y descuentos de la venta" solo si es distinto de cero. Artículos igual que hoy.

## 5. Abuso y rastro

- Los nombres de departamento/categoría solo se muestran; no deciden dinero, permisos ni VIP.
- Una llave de tienda solo escribe artículos de su tienda.
- Texto con límites y UTF-8 estricto; React escapa al mostrar.
- El agente sigue en solo lectura; la consulta nueva pasa la guardia existente sin aflojarla.

## 6. Pruebas (TDD; cada una se ve ROJA antes de implementar)

- Contrato/ingesta: lote con `articulos` válido se guarda; lote solo de artículos avanza secuencia; sin `articulos`
  idéntico a hoy; 501 artículos → 422; `art_id` repetido → 422; campo de 101 → 422; `�` → rechazo; reenvío idéntico
  devuelve el recibo original; upsert reemplaza; tienda sale de la llave.
- Respaldo: con la tabla nueva restaura; respaldos de 10, 12 y 14 tablas siguen restaurando.
- Qué compra: renglón SICAR con artículo clasificado; sin artículo cae a catálogo por sku; sin nada → "Sin
  departamento"; nombres con distinta mayúscula/acento se suman; Σ departamentos + ajustes = total; Σ categorías =
  departamento; POS por catálogo; persona de otra tienda → 404 (sigue).
- Agente: esquema completo → manda páginas de 500 en ventana; fuera de ventana no manda; `--articulos-ahora` manda;
  columnas faltantes → `ARTICULOS_NO_DISPONIBLES` y las ventas se siguen mandando; consulta pasa `seguridad.js`;
  cursor solo avanza con 200; `--verificar` reporta columnas y conteo.
- Suites: backend completa, agente completa, `npx eslint src backend agente-sicar`: 0 fallas, 0 errores.
- Navegador (Claude): ficha con departamentos y categorías con base de prueba.

## 7. Fuera de alcance

Importar el catálogo SICAR a CORPUNISOUND (opción B); familias del Radar; Entrega 4; precios, existencias o costos de
SICAR.

## 8. Activación en Ocosingo (después del merge, con Victor)

1. Actualizar el agente en la PC de Ocosingo.
2. `--verificar`: confirmar columnas de `articulo`/`categoria`/`departamento`. Si los nombres difieren, se corrige
   `COLUMNAS_ARTICULOS` antes de seguir.
3. `--articulos-ahora`; Claude mide en producción cuánto queda "Sin departamento".
