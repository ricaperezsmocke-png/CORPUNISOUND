# Despacho a Codex: Resurtido — pulido tras el primer cálculo real

## Contexto

La Entrega 1 del resurtido (mínimos y máximos JR y Solcor por tienda) está en producción desde `87a1fb7`. El primer
cálculo real (2026-11-18 22:54Z, 3,032 claves) se comparó contra una lectura directa del SICAR de San Cristóbal
(sucursal_id 3 en CORPUNISOUND) y salieron tres defectos. Spec y plan originales:
`docs/superpowers/specs/2026-11-18-resurtido-minmax-design.md` y `docs/superpowers/plans/2026-11-18-resurtido-minmax-claude.md`.
Léelos para el modelo de datos; **las decisiones de negocio de ese plan siguen congeladas**.

Números reales de San Cristóbal (formato `clave|existencia|min|max|venta_mes|dias_en_cero`, venta_mes = venta_diaria×30):

```
CUE1A|18|25|37|11.8|0      SICAR: 6.1 piezas/mes en los últimos 12 meses (73/año), 116 días en cero
SPE4SOL-P|0|17|25|7.4|0    SICAR: 54 días en cero
CUE1BS|0|18|28|9.8|50      CUE1V|0|12|19|6.3|111      F5JR|0|4|7|2.0|123
UR2X16NEF|0|67|100|33.0|257  (SICAR: 311 días en cero)
```

San Cristóbal: 758 claves → 556 `sin_historia`, 175 `calculado`, 27 `no_se_mueve`; 615 en estado `agotado`.
La lectura de SICAR cuenta TODAS las ventas vigentes (incluidas internas), así que la cifra real de CORPUNISOUND
debería salir igual o **menor**, nunca el doble.

## Dónde

- Worktree: `C:\Users\Victor\Desktop\CORPUNISOUND\.claude\worktrees\resurtido-pulido`
- Rama: `fix/resurtido-pulido`, base `87a1fb7` (master = producción). Confirma con `git status` y `git log -1`.
- Entorno ya puesto (node_modules raíz y backend copiados, `backend/.env`, `backend/datos.sqlite`).

## Qué se te pide (en este orden)

### Tarea 1 — Agotados falsos: claves que la tienda ya no maneja

Hoy `existenciaActual` (`backend/resurtido/lector.js`) y `listar` (`backend/resurtido/consultas.js`) hacen LEFT JOIN a
`sicar_existencias` con `COALESCE(...,0)`: una clave sin ninguna fila de existencia cuenta como 0 → mínimo 1 y "agotado".
En San Cristóbal son casi todas artículos dados de baja en SICAR, que el agente no manda.

**Antes de cambiar nada, verifica en `agente-sicar/` (solo lectura) y en `backend/sicarRepositorio.js`:**
(a) si el agente manda fila de existencia para un artículo vigente con existencia 0; (b) si `sicar_articulos` guarda
algún indicador de vigencia/baja. Con eso:
- Si un vigente en 0 SÍ trae fila: la regla es "una clave entra al cálculo y a la lista solo si al menos uno de sus
  `art_id` tiene fila en `sicar_existencias`".
- Si hay un campo de vigencia confiable en `sicar_articulos`, úsalo en vez de (o además de) lo anterior y explica por qué.
- **Si un vigente en 0 NO trae fila y no hay campo de vigencia: DETENTE y reporta.** Excluir esas claves escondería
  agotados reales, que es justo lo que el resurtido debe ver.

Las claves excluidas no se calculan, no aparecen en la lista y no cuentan en los totales; una clave excluida que tenga
ajuste manual (`resurtido_ajustes`) **sí** sigue apareciendo (con su marca de "ya no la maneja la tienda"), para que el
ajuste no desaparezca sin rastro. Los renglones viejos de `resurtido_minmax` de claves excluidas se borran en el
siguiente recálculo de esa tienda.

### Tarea 2 — Venta diaria inflada (mínimos casi al doble)

Hipótesis de Claude (verifícala con pruebas antes de corregir): en `calcularMinMax` (`backend/resurtido/calculo.js`)
`mu` es el **promedio de cocientes** `venta_dia / indice_mes`. Con productos de venta esporádica y meses de índice bajo
(acotados a 0.5 en `temporada.js`), cada venta suelta en un mes "flojo" cuenta doble y `mu` sale inflado; luego se
multiplica por el factor del mes. Corrección pedida: **cociente de sumas**,
`mu = Σ venta_dia_valido / Σ indice_mes(dia_valido)`, sobre los mismos días válidos. La varianza se calcula sobre los
mismos valores desestacionalizados que hoy, pero centrada en el nuevo `mu`.

Pruebas mínimas (rojas antes del cambio):
- Con índices todos en 1, el resultado no cambia respecto a hoy (regresión).
- Producto esporádico: 73 piezas en 365 días repartidas en meses de índice 0.5, mes de cálculo con factor 1 → venta
  diaria ≈ 73/365·(365/Σíndices), y en ningún caso el doble del promedio simple cuando los índices promedian 1.
- Caso CUE1A sintético: ventas uniformes de 6.1/mes, índices realistas que promedian 1 → `venta_diaria×30` entre 5 y
  7.5 para cualquier mes de cálculo cuyo factor esté entre 0.8 y 1.2.

Además, en `temporada.js`, revisa si los años **anteriores a 2025** sesgan los índices: las ventas de mostrador
(público en general) solo se cargaron desde 2025 (ver `agente-sicar/corrida.js`, "Carga de ventas de mostrador desde
2025"), así que antes de 2025 solo hay ventas con cliente. Si con una prueba demuestras que mezclar años con y sin
mostrador mueve los índices, limita el cálculo de índices a años con ambas fuentes completas por tienda y anótalo. Si
no lo puedes demostrar, no lo cambies: solo repórtalo.

### Tarea 3 — Días en cero que no se ven (reconstrucción incompleta)

`reconstruir` (`backend/resurtido/existenciaDiaria.js`) camina hacia atrás desde la existencia actual sumando ventas y
traspasos. Si faltan entradas en la historia, la existencia reconstruida nunca baja a 0 y los días en cero salen en 0
(CUE1A: 0 aquí contra 116 en SICAR). **Diagnóstico por lectura de código, sin producción**:
1. Qué movimientos de existencia NO entran a la reconstrucción y sí existen en tablas de CORPUNISOUND
   (`sicar_compras`/su detalle, traspasos con sucursal sin mapa o con `baja=1`, traspasos `cancelado`, ajustes, etc.).
   Revisa el JOIN con `sicar_sucursales_mapa`: un traspaso cuyo origen o destino no está mapeado se descarta entero.
2. Qué movimientos no llegan nunca a CORPUNISOUND (lo que el agente no lee). Solo repórtalo, **no toques el agente**.

Corrige 1 (lo que sí está en las tablas) con pruebas. Para 2, propón en el informe la alternativa más barata.

### Tarea 4 — Explicación por producto (pantalla y diagnóstico)

Ruta nueva de solo lectura `GET /api/resurtido/explicacion?sucursal_id=&clave=`, mismo permiso `ver_resurtido` y el
mismo `alcance()` de `backend/resurtido/rutas.js` (tienda solo del token). Devuelve, para esa tienda y clave:
existencia actual; piezas vendidas en la ventana (`dias_historia`) sin temporada; venta mensual simple
(piezas/días·30); días en cero y cuántos son observados vs reconstruidos; índices de temporada de la marca (12 números)
y el factor aplicado al mes de cálculo; venta diaria final; mínimo y máximo; y la serie mensual de los últimos 12 meses
(piezas vendidas, entradas por traspaso/compra, salidas por traspaso, existencia reconstruida al cierre de mes).
Todo en piezas enteras o con un decimal, nada de diezmilésimas en la respuesta.

En `src/resurtido/Resurtido.jsx`: al dar clic en la clave se abre un panel (modal con scroll, patrón de los modales
existentes) que muestra esa explicación en lenguaje de tienda: "Vendió X piezas en los últimos 12 meses (Y al mes).
Estuvo Z días en cero. Por temporada de noviembre se ajusta ×F. Mínimo M, máximo N."

### Tarea 5 — Nombre en vez de número en la corrección

Hoy dice "Corregido a mano por 1". Debe decir el nombre del usuario. `resurtido_ajustes.actor` guarda el id como texto;
resuelve el nombre en el backend al listar (los usuarios viven en el DB en memoria de `server.js`: pasa un resolvedor
`nombreDeUsuario(id)` a `registrarRutasResurtido`, no leas el DB global desde `consultas.js`). Si el usuario ya no
existe, muestra "usuario #id".

## Cómo correr pruebas (obligatorio)

Desde `backend/`: `node --preserve-symlinks --preserve-symlinks-main --test <archivo>.test.js` (archivos explícitos).
Sin esas banderas el sandbox da EPERM: no es fallo del código, no "arregles" el entorno. **No corras la suite completa
ni commitees** (el sandbox no puede crear `index.lock`): la suite y los commits los hace Claude. Deja los cambios sin
commitear. Pruebas de `src/`: mismo comando desde la raíz del worktree. ESLint: `npx eslint <archivos tocados> --quiet`.

## Reglas

- Prueba roja primero por conducta ausente; luego lo mínimo para verde.
- Ninguna dependencia nueva. Ninguna línea de más de 200 caracteres.
- Acentos correctos en código e interfaz, UTF-8 sin mojibake (revisa "ó", "í", "ñ" en el archivo final).
- Permisos solo en `backend/permisosCatalogo.js` (esta entrega no debería necesitar permisos nuevos).
- Tablas nuevas, si hicieran falta, al final de `TABLAS` en `backend/sicarRespaldo.js` con generación nueva. Intenta no
  necesitarlas.
- **Prohibido:** `agente-sicar/` (solo lectura), `render.yaml`, producción, push, merge, rebase, `git add .`.
- El resurtido sigue sin pedir ni mover mercancía: nada de pedidos, traspasos ni escrituras a inventario.

## Cuándo detenerte y reportar

- Tarea 1 con vigentes en 0 sin fila de existencia (ver arriba).
- Si la Tarea 2 muestra que la causa del doble NO es el promedio de cocientes: reporta la causa con la prueba que lo
  demuestra antes de cambiar otra cosa.
- Si una prueba existente se pone roja y no ves por qué; si el plan contradice el código y no hay corrección obvia; si
  necesitas una dependencia. Diferencias de nombre o firma con corrección evidente: corrige, anótalo y sigue.

## Informe final (en español)

Por tarea: archivos tocados, pruebas nuevas (cuántas, cuántas rojas antes), salida del comando de prueba, desviaciones
y su razón. Para Tarea 3, la lista de movimientos que faltan (en tablas vs nunca llegan). Al final: lo que no hiciste
y riesgos.
