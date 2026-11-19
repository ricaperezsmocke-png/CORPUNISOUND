# Despacho a Codex: Resurtido — pulido 2 (decisiones de Victor sobre números reales)

## Contexto

`fix/resurtido-pulido` ya está en producción (`6fc78a8`). Con los datos reales de San Cristóbal (sucursal_id 3) los días
en cero y las ventas ya cuadran con SICAR (CUE1A: 116 días en cero y 73 piezas al año, igual que SICAR). Quedan tres
defectos de criterio, y Victor ya decidió cómo resolverlos (2026-11-19). **Las decisiones están congeladas: no las
reabras.** Lee antes `docs/superpowers/despachos/2026-11-19-resurtido-pulido.md` y el código de `backend/resurtido/`.

## Dónde

- Worktree: `C:\Users\Victor\Desktop\CORPUNISOUND\.claude\worktrees\resurtido-pulido`
- Rama: `fix/resurtido-pulido-2`, base `6fc78a8` (master = producción). Confirma con `git status` y `git log -1`.
- Entorno ya puesto (node_modules raíz y backend, `backend/.env`, `backend/datos.sqlite`).

## Tarea 1 — Ventas grandes de un solo ticket = pedido especial

Caso real: POT18BIC (potenciómetro) vende 5 a 9 al mes, pero en agosto un ticket se llevó 63 → mínimo 70. UR2X14NEF
(cable por metro) tuvo 111 m en marzo.

**Decisión de Victor:** si un solo renglón de ticket se lleva más de lo que el producto vende normalmente en un mes, el
excedente no cuenta para el mínimo ni el máximo.

Regla exacta (una sola pasada, sin iterar):
1. `tope_mensual` de la clave en esa tienda = piezas vendidas en la ventana (`dias_historia`, sin internas, igual que
   hoy) ÷ días válidos (días que NO están en cero, o con venta) × 30. Si no hay días válidos, no hay tope.
2. Cada renglón de venta (por `ven_id` + `art_id`, en `sicar_detalles` y `sicar_detalles_mostrador`) cuenta como
   `min(cantidad, max(1 pieza, tope_mensual))`. El tope se redondea hacia arriba a pieza entera.
3. Con esas cantidades topadas se arma `ventasPorDia` para `calcularMinMax`; el resto del cálculo no cambia.
4. Las ventas a cuentas internas siguen fuera de la demanda. La reconstrucción de existencia (`movimientos.js`) **sigue
   usando las cantidades completas**: el tope solo afecta la demanda, nunca la existencia.

Hoy `filasVentas` (`backend/resurtido/lector.js`) agrega por día con `GROUP BY`; necesitarás leer por renglón de ticket
para la demanda. Hazlo en una función nueva; no cambies lo que reciben `movimientos.js` ni `ventasMensualesMarca`.

En la explicación (`backend/resurtido/explicacion.js` y `src/resurtido/Explicacion.jsx`) agrega
`piezas_pedido_especial` (excedente que no contó) y el texto: "N piezas vendidas en tickets grandes se tomaron como
pedido especial y no suben el mínimo." Solo si N > 0.

Pruebas (rojas antes): ticket de 63 en un producto de ~6 al mes no sube el mínimo por encima de lo que daría sin ese
ticket más el tope; un producto sin tickets grandes da exactamente lo mismo que hoy; la existencia reconstruida no
cambia con el tope.

## Tarea 2 — Catálogo sin movimiento: no se pide

Cada tienda tiene ~270 claves vigentes en SICAR, en cero y sin ninguna venta en la ventana. Hoy caen en
`total === 0` con ≥80% de días en cero → `sin_historia`, mínimo 1 y máximo 2, estado "agotado".

**Decisión de Victor:** mínimo 0, máximo 0, en una lista aparte, "catálogo sin movimiento". Si quiere alguno, lo corrige
a mano.

- En `calcularMinMax`: si `total === 0` → mínimo 0 y máximo 0 siempre. Lista `sin_movimiento` si la proporción de días
  en cero es ≥ `proporcion_cero_sin_historia`; si no, `no_se_mueve` (como hoy).
- `sin_historia` queda solo para claves CON ventas pero con menos de `dias_validos_minimos` días válidos (como hoy).
- En `listar` (`consultas.js`): una clave con mínimo efectivo 0 y existencia ≤ 0 tiene estado `sin_pedir`, no
  `agotado`. Acepta `sin_movimiento` en el filtro de lista y `sin_pedir` en el de estado (lista blanca, como hoy).
- Pantalla: opción de filtro "Catálogo sin movimiento (no se pide)" y estado "No se pide". Si la clave tiene ajuste
  manual, manda el ajuste como hoy (su estado se calcula con el mínimo del ajuste).

Pruebas (rojas antes): clave vigente en cero sin ventas → 0/0, `sin_movimiento`, estado `sin_pedir`; la misma con ajuste
de mínimo 2 → estado `agotado`; clave con existencia y sin ventas sigue `no_se_mueve`.

## Tarea 3 — Temporada medida en SICAR mientras falte historia completa

Los índices calculados en CORPUNISOUND salen sesgados porque antes de 2025 solo existen ventas con cliente (el mostrador
se carga desde 2025). Lectura directa del SICAR de San Cristóbal, años completos 2022–2025, todas las ventas:

```
JR:     1:0.9 2:1 3:1.1 4:1 5:1 6:1.1 7:0.9 8:0.9 9:1.1 10:1 11:1 12:1
SOLCOR: 1:0.9 2:0.9 3:1.1 4:0.8 5:0.6 6:1.2 7:1.1 8:0.9 9:1.1 10:1.3 11:1.2 12:1
```

CORPUNISOUND hoy calcula JR 11:1.2 12:1.5 y SOLCOR 10:1.0 11:1.0 12:1.5. **Decisión (delegada por Victor a Claude):**
1. Constante `INDICES_SICAR` en `backend/resurtido/config.js` con esos 24 valores, congelada (`Object.freeze`).
2. `ventasMensualesMarca` lee solo desde `2025-01-01` (años con ventas de cliente y de mostrador).
3. En `servicio.js` y `explicacion.js`: se calcula `indicesTemporada` con esos datos; si su `motivo` no es `null`
   (menos de dos años completos o menos de cinco claves), se usan los `INDICES_SICAR` de la marca. A partir de que haya
   2025 y 2026 completos (enero 2027) los índices pasan a calcularse solos, sin tocar código.
4. La explicación devuelve `temporada_origen`: `'sicar'` o `'calculada'`, y la pantalla dice "Temporada medida en SICAR
   de San Cristóbal (2022–2025)" o "Temporada calculada con las ventas de las cuatro tiendas".

Pruebas (rojas antes): con solo 2025 completo se usan los índices SICAR (JR noviembre → factor 1.0, SOLCOR noviembre →
factor 1.1); con 2025 y 2026 completos se usan los calculados; ventas anteriores a 2025 no afectan los índices.

## Tarea 4 — Que el cálculo no congele el servidor

`recalcular` corre todo sincrónico: con 3,032 claves congela el servidor ~13 s (al arrancar +1 min y a las 2 a.m.).
Cambia `iniciarCicloResurtido` para que cada vuelta calcule **una tienda por turno del event loop** (`setImmediate`
entre tiendas, conservando una transacción por tienda como hoy). `recalcular(sqlite, ahora)` sigue existiendo y
funcionando igual para las pruebas y para quien lo llame. La guarda `ejecutando` debe cubrir la vuelta completa (no se
encima una segunda vuelta mientras la primera va a medias), y `detener()` a media vuelta no programa la siguiente.

Pruebas: una vuelta con reloj y `programar` falsos procesa las cuatro tiendas en cuatro turnos; `detener()` a media
vuelta corta; el resultado guardado es idéntico al de `recalcular`.

## Cómo correr pruebas (obligatorio)

Desde `backend/`: `node --preserve-symlinks --preserve-symlinks-main --test <archivo>.test.js` (archivos explícitos).
Sin esas banderas el sandbox da EPERM: no es fallo del código. **No corras la suite completa ni commitees**: lo hace
Claude. Pruebas de `src/`: mismo comando desde la raíz. ESLint: `npx eslint <archivos tocados> --quiet`.

## Reglas

- Prueba roja primero por conducta ausente; luego lo mínimo para verde.
- Ninguna dependencia nueva. Ninguna línea de más de 200 caracteres. Acentos correctos, UTF-8 sin mojibake.
- Ninguna tabla nueva. Ningún permiso nuevo.
- **Prohibido:** `agente-sicar/` (solo lectura), `render.yaml`, producción, push, merge, rebase, `git add .`.
- **No hagas cambios fuera de estas cuatro tareas**, aunque te parezcan mejoras. Si ves algo que cambiaría números,
  repórtalo sin tocarlo (en la entrega anterior un cambio no pedido apagó la temporada y hubo que revertirlo).
- El resurtido sigue sin pedir ni mover mercancía.

## Cuándo detenerte y reportar

- Si la lectura por renglón de ticket (Tarea 1) no es posible con las tablas actuales sin cambiar la ingesta.
- Si una prueba existente se pone roja y no ves por qué, o una decisión de arriba contradice el código sin corrección
  evidente. Diferencias de nombre o firma con corrección obvia: corrige, anótalo y sigue.

## Informe final (en español)

Por tarea: archivos tocados, pruebas nuevas (cuántas, cuántas rojas antes), salida del comando de prueba, desviaciones
y su razón. Al final: lo que no hiciste y riesgos.
