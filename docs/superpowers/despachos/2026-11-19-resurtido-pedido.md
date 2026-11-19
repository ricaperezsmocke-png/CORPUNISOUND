# Despacho: Resurtido — pedido guardado con visto bueno, rollos de cable y traspasos entre tiendas

## Contexto

En producción (`470ae74`): mínimos/máximos JR y Solcor por tienda, explicación por producto y **sugerido de pedido de
solo lectura** (`backend/resurtido/sugerido.js`: `enCamino`, `calcularSugerido`; `consultas.js`: `armar`,
`listaProveedor`; ruta `GET /api/resurtido/sugerido`; pantalla `ListaProveedor.jsx`). Victor pidió (2026-11-19) los tres
pendientes: (1) pedido guardado con visto bueno del encargado, aprobación y revisión de lo que llegó; (2) redondeo del
cable a rollos; (3) traspasos entre tiendas antes de comprar.

Es la **Entrega 2 (Tasks 9–12) y la Entrega 3 (Task 13)** del plan `docs/superpowers/plans/2026-11-18-resurtido-minmax-claude.md`
y del spec `docs/superpowers/specs/2026-11-18-resurtido-minmax-design.md` §6.3–6.4. **Léelos completos.** Las reglas de
esas tareas están decididas; este despacho solo ajusta lo que cambió desde que se escribieron (abajo, "Ajustes").

## Dónde

- Worktree: `C:\Users\Victor\Desktop\CORPUNISOUND\.claude\worktrees\resurtido-pulido`
- Rama: `feature/resurtido-pedido`, base `470ae74`. Confirma con `git status` y `git log -1`. Entorno ya puesto.

## Orden

Parte A: Task 9 → 10 → 11 → 12 (pedido y empaques). Parte B: Task 13 (avisos y traspasos). Commits por tarea los hace
Claude: deja cada tarea terminada y probada antes de pasar a la siguiente, y anota en el informe qué archivos son de
cuál tarea.

## Ajustes al plan (decisiones de Claude, 2026-11-19)

1. **Reusar lo que ya existe.** El cálculo del borrador sale de `armar()` / `calcularSugerido()` (mismas reglas:
   existencia negativa cuenta 0, listas que no se piden, tienda atrasada fuera, ajuste manual manda). No dupliques la
   fórmula. `enCamino` (sugerido.js) se **amplía** para sumar también los renglones de pedidos `aprobado`/`enviado` aún
   no llegados (`pedido - llegado`, con el mismo tope de 45 días desde `aprobado_en`); el sugerido de solo lectura y el
   borrador quedan así consistentes.
2. **Borrador a mano, además del ciclo.** Además del borrador automático del día de corte (Task 9), botón "Armar
   borrador ahora" (permiso `aprobar_pedido_resurtido`) que crea el borrador del periodo actual si no existe (misma llave
   única marca+periodo+tipo). Victor quiere usarlo ya, no esperar al día 1.
3. **Empaques (rollos).** No hay dato de unidad de venta en `sicar_articulos`: no lo inventes. Pestaña "Empaques": todas
   las claves SOLCOR; las que su descripción empieza con `CABLE` aparecen con **sugerencia** de rollo de 100 m sin
   confirmar. Una persona con `configurar_resurtido` confirma, cambia (100 o 200 o cualquier entero > 1) o quita el
   empaque; queda quién y cuándo, con historial. **Solo un empaque confirmado redondea** (regla del plan). Redondeo y
   reparto del sobrante exactamente como Task 9.
4. **Permisos.** `dar_visto_bueno_resurtido` y `aprobar_pedido_resurtido` ya existen en `backend/permisosCatalogo.js`
   con `implementado: false`: pásalos a `true` al terminar sus rutas. No crees permisos nuevos. Alcance de tienda **solo
   del token** (`alcance()` de `rutas.js`); el encargado solo ve y cambia su tienda.
5. **Tablas nuevas** de Task 9 y Task 13 (incluida `resurtido_reservas` y una tabla de historial de empaques) **al
   final** de `TABLAS` en `backend/sicarRespaldo.js`, con una generación nueva que deja legibles todas las copias viejas
   (sigue el comentario de `GENERACIONES`). Tras restaurar un respaldo: `pedidos_pausados = 1` (Task 9).
6. **Salida al proveedor.** `listaProveedor` del pedido guardado usa el mismo formato de texto que ya existe en
   `src/resurtido/resurtido.js` (`textoWhatsApp`), incluido el aviso de tiendas fuera. El sistema no manda nada:
   `registrarEnvio` solo cuando una persona dice que ya lo mandó (Task 10).
7. **Traspasos entre tiendas (Task 13).** Reglas tal cual el plan: la donante nunca queda abajo de su máximo; reservas
   de 3 días; la receptora ve de la donante solo nombre, clave y piezas ofrecidas. El sistema **no crea traspasos en
   SICAR**: propone, una persona decide, y el traspaso se hace en SICAR como hoy; la reserva se consume cuando aparece en
   `sicar_traspasos`. Además: en la "Lista para el proveedor" y en el borrador, si para una clave hay donante con
   sobrante, mostrar "Antes de comprar: San Cristóbal tiene N de sobra" junto al renglón (solo aviso; no cambia números).
8. **Pedido extra** ("pedir" en un aviso): pedido tipo `extra` de la marca, mismo visto bueno y aprobación; su llave
   única incluye el id del aviso para que dos clics no dupliquen.

## Lo que se cuida (contra abuso y contra errores)

- Toda regla de alcance y permiso va en el servidor. Ids del cuerpo pueden ser texto: `Number(...)` antes de comparar.
- Cambios de cantidad: historial con antes/después, actor y fecha; subir más de 2× lo sugerido exige motivo y queda
  marcado para quien aprueba; cambiar después del visto bueno lo anula; nada cambia después de aprobar.
- El pedido no mueve inventario ni dinero en CORPUNISOUND. Lo que llega se lee de SICAR (Task 11).
- Fechas solas con `fechaLocal()`; marcas completas ISO UTC.

## Pruebas

Las de cada tarea del plan (rojas antes) más: borrador a mano no duplica el del ciclo; `enCamino` descuenta lo pedido y
aprobado no llegado y deja de descontarlo al llegar; empaque sugerido sin confirmar no redondea y confirmado sí; aviso de
"tiene de sobra" aparece solo con donante arriba de su máximo; permisos con roles de permisos vecinos (no `[]`).
Ruta real (patrón `backend/resurtido/rutas.test.js`) para visto bueno, aprobar, envío, empaques y avisos.

Comandos: desde `backend/` `node --preserve-symlinks --preserve-symlinks-main --test <archivos>`; `src/` igual desde la
raíz; ESLint con `--quiet` sobre lo tocado. **No corras la suite completa ni commitees**: lo hace Claude.

## Reglas

- Prueba roja primero. Ninguna dependencia nueva. Ninguna línea de más de 200 caracteres. Acentos correctos, UTF-8.
- Modales con scroll; botones de formulario con `type` explícito.
- **Prohibido:** `agente-sicar/`, `render.yaml`, producción, push, merge, rebase, `git add .`. Nada fuera de este alcance.

## Cuándo detenerte y reportar

- Si el plan contradice el código sin corrección evidente, o una regla de arriba choca con otra.
- Si para "lo que llegó" (Task 11) los traspasos o compras de CEDIS no traen lo necesario.
- Si una prueba existente se pone roja y no ves por qué. Diferencias de nombre/firma con corrección obvia: corrige,
  anótalo y sigue.

## Informe final (en español)

Por tarea: archivos, pruebas nuevas (cuántas rojas antes), salida de comandos, desviaciones. Al final: lo que no hiciste
y riesgos.
