# Despacho a Codex: Resurtido — sugerido de pedido (primer paso de la Entrega 2)

## Contexto

El resurtido JR/Solcor está en producción (`11f20ca`) con mínimos y máximos ya revisados contra SICAR. Victor pidió
(2026-11-19) que el sistema **sugiera cuántas piezas pedir**. Esto es la parte de cálculo de la "Entrega 2 — Pedido
mensual" del plan `docs/superpowers/plans/2026-11-18-resurtido-minmax-claude.md` (Task 9) y del spec
`docs/superpowers/specs/2026-11-18-resurtido-minmax-design.md` §6.3. **Solo el sugerido, de lectura**: sin tablas de
pedidos, sin visto bueno, sin aprobar, sin empaques. Eso viene después.

## Dónde

- Worktree: `C:\Users\Victor\Desktop\CORPUNISOUND\.claude\worktrees\resurtido-pulido`
- Rama: `feature/resurtido-sugerido`, base `11f20ca` (master = producción). Confirma con `git status` y `git log -1`.
- Entorno ya puesto.

## Tarea 1 — En camino

`enCamino(sqlite, sucursal_id, desde)` en `backend/resurtido/` (archivo nuevo o `movimientos.js`), devuelve
`Map<clave, diezmilésimas>`: piezas de traspasos **hacia esa tienda** con estado `enviado` (salieron, todavía no
`recibido`), con fecha de salida en los últimos **45 días**. Mismas reglas de punta y deduplicación que `movimientos.js`
(una sola punta por folio/origen/destino; `LEFT JOIN` al mapa de sucursales; destino = la tienda). Traspasos
`cancelado` no cuentan. Uno `enviado` de más de 45 días no cuenta (se considera perdido o mal capturado) y se reporta
aparte como `en_camino_viejo` en la explicación.

## Tarea 2 — Sugerido por tienda y clave

Regla (revisión periódica hasta el máximo, decisión ya tomada en el plan):

```
sugerido = max(0, maximo_efectivo - max(existencia, 0) - en_camino)   en piezas enteras (ceil a pieza)
```

- `maximo_efectivo` = el del ajuste manual si existe; si no, el calculado.
- **No se sugiere** (sugerido 0) para listas `no_se_mueve` y `sin_movimiento`, salvo que tengan ajuste manual con
  máximo > 0 (entonces aplica la fórmula con el ajuste).
- Tiendas con datos atrasados (`tiendas_atrasadas`): sugerido `null` y la pantalla dice "Datos atrasados: no se sugiere".
- Claves `ya_no_la_maneja`: sugerido 0.

`listar` (`consultas.js`) agrega a cada fila `en_camino` y `sugerido` (diezmilésimas, como los demás campos). La
explicación (`explicacion.js`) agrega `en_camino`, `en_camino_viejo` y `sugerido`, y la pantalla la frase: "Se sugiere
pedir N (máximo M − hay E − en camino C)."

## Tarea 3 — Lista para el proveedor

Ruta nueva de solo lectura `GET /api/resurtido/sugerido?marca=JR|SOLCOR` con permiso `ver_resurtido` y el mismo
`alcance()` de `rutas.js` (tienda solo del token; quien no ve todas solo recibe su tienda). Devuelve, para la marca:
renglones por clave con `descripcion`, `total` (suma de las tiendas) y `por_tienda: [{sucursal_id, sugerido}]`, solo
claves con total > 0, ordenadas por clave; más `tiendas_atrasadas`. Marca fuera de la lista blanca → 400.

Pantalla `src/resurtido/`: botón "Lista para el proveedor" que abre un modal con scroll (patrón de los modales
existentes) con selector JR/SOLCOR, tabla Clave · Producto · Total · Ocosingo · Yajalón · San Cristóbal · Palenque, y
botón **"Copiar para WhatsApp"** que copia texto plano:

```
Pedido JR — 19/11/2026
CUE1A CUERDAS D ACERO 1as ... — 24 (Oco 6, Yaj 4, SC 10, Pal 4)
...
```

Las cantidades de cable por metro van en metros, sin redondear a rollo (todavía no hay empaques confirmados): la línea
lleva " m" después del número cuando la clave es de unidad metro. Si no existe forma confiable de saber la unidad en
`sicar_articulos`, NO la inventes: déjalo sin " m" y repórtalo.

En la tabla principal agrega la columna **"Pedir"** con el sugerido. El sistema **no envía nada** a nadie: solo copia.

## Pruebas (rojas antes)

- Traspaso CEDIS → tienda `enviado` hace 10 días cuenta en camino; `recibido` no; `cancelado` no; `enviado` de hace 60
  días no cuenta y aparece en `en_camino_viejo`.
- Fórmula: máximo 20, hay 5, en camino 8 → 7; hay 25 → 0; con ajuste máximo 30 → usa 30; `sin_movimiento` → 0;
  `sin_movimiento` con ajuste máximo 2 y hay 0 → 2; tienda atrasada → `null`.
- Ruta: sin permiso 403; usuario de una tienda solo ve su tienda aunque mande otra; marca inválida 400; total = suma.
- Pantalla (`src/resurtido/resurtido.test.js`): el texto de WhatsApp sale con el formato de arriba.

## Cómo correr pruebas (obligatorio)

Desde `backend/`: `node --preserve-symlinks --preserve-symlinks-main --test <archivo>.test.js` (archivos explícitos).
**No corras la suite completa ni commitees**: lo hace Claude. `src/`: mismo comando desde la raíz. ESLint sobre los
archivos tocados con `--quiet`.

## Reglas

- Prueba roja primero. Ninguna dependencia nueva. Ninguna línea de más de 200 caracteres. Acentos correctos, UTF-8.
- **Ninguna tabla nueva, ningún permiso nuevo, ninguna escritura**: todo es lectura.
- **No hagas cambios fuera de estas tres tareas.** Si ves algo que cambiaría números, repórtalo sin tocarlo.
- **Prohibido:** `agente-sicar/`, `render.yaml`, producción, push, merge, rebase, `git add .`.

## Cuándo detenerte y reportar

- Si para "en camino" hace falta información que no está en `sicar_traspasos` / `sicar_traspasos_detalle`.
- Si una prueba existente se pone roja y no ves por qué. Diferencias de nombre o firma con corrección obvia: corrige,
  anótalo y sigue.

## Informe final (en español)

Por tarea: archivos tocados, pruebas nuevas (cuántas, cuántas rojas antes), salida del comando, desviaciones. Al
final: lo que no hiciste y riesgos.
