# Entrega C3 — Cierre de mes y ventanas de objetivos estilo SICAR

Fecha: 2026-09-25. Diseño aprobado por Victor en conversación ("si esta bien tienes mi ok").

Rama `feature/objetivos-c3-cierre`, base `ce0bb01` (master con C1 y C2 en producción).
Precedente de estilo: C1/C2 (rejilla `bg-blue-600 text-white`, filas `odd:bg-white even:bg-blue-50`,
`pesosConCentavos`, `fechaCorta`).

## Objetivo

Que quien cierra el mes vea de un vistazo qué tienda y mes está sellando, cuánto le falta capturar y
quién tiene diferencia; y que las ventanas digan exactamente qué se está cambiando. **Solo
presentación.** No cambia ninguna regla, ruta, permiso ni dato del servidor. Se usa en COMPUTADORA.

## Alcance

Archivos autorizados:
- `src/CierreObjetivos.jsx` (presentación del cierre abierto y sellado, ventana de rectificar).
- `src/objetivos/CierreElementos.jsx` (misma rejilla estilo SICAR; botones Rectificar por cifra).
- `src/objetivos/DialogosObjetivos.jsx` (`Modal`: mejoras compatibles hacia atrás, ver parte 3).
- `src/GerenciaVentas.jsx` SOLO las ventanas de meta (`editando`) y baja (`baja`): títulos, textos,
  botón y la cifra actual. `editarMeta`, `darDeBaja`, `guardarMeta` y sus peticiones NO cambian,
  salvo guardar en el estado `editando` el monto anterior para mostrarlo.
- `src/objetivos/marcas.js`, `src/objetivos/datos.js` y sus `.test.js`: funciones puras nuevas.

Prohibido: todo `backend/`, pantallas de vendedora y de reparto (C1/C2), `MarcasGerente.jsx`,
`CreditosVendedor.jsx`, `MarcasDelDia.jsx`, dependencias nuevas, CSS global.

## Parte 1 — Cierre con mes ABIERTO (previo)

1. **Encabezado**: `OCOSINGO · SEPTIEMBRE 2026 · 🔓 ABIERTO` (nombre de sucursal que ya calcula
   `nombreSucursal`, mes en palabras con año).
2. **Contador** debajo: `Importes por capturar: 3 de 4 capturados · Personas con diferencia: 1`.
   "Importes" = TODOS los campos que exige el cierre (SICAR por persona + real de cada marca,
   producto y financiera), es decir el mismo universo que `camposFaltantesCierre(previo, valores)`;
   capturados = total − faltantes. "Personas con diferencia" = personas con al menos un campo ya
   capturado cuya diferencia ≠ 0 en centavos (venta o cualquier elemento). Se recalcula al teclear.
3. **Rejilla de VENTA** estilo SICAR: Persona, Meta, Capturó, Real SICAR (campo), Diferencia.
   Diferencia: `✔ Cuadra` (verde) / `Capturó $X más que SICAR` / `Capturó $X menos que SICAR`
   (ámbar) / `falta el real` (gris). Campo faltante marcado en rojo como hoy. SIN columna de
   actividades.
4. **Marcas, productos y créditos** (CierreElementos): mismo contenido y comportamiento, con rejilla
   de encabezado azul por persona.
5. **Panel "Actividades del mes · declaradas, no verificadas"** DESPLEGABLE (cerrado por defecto,
   `aria-expanded`), con la nota `No cuentan para la diferencia de SICAR.` y una rejilla:
   Persona, y por cada actividad `declaradas / meta` (+ `Conjuntas: N` si > 0). Si una línea no trae
   `actividades`: `Este cierre no incluye datos de actividades.` El aviso aparece UNA vez.
6. Botón `Revisar y cerrar` al final: misma lógica (`revisar` → faltantes en rojo o confirmación).
   La ventana de confirmación actual se conserva (ya muestra tienda, mes, personas y diferencias);
   solo cambiar el mes `2026-09` por `septiembre 2026`. NO se exige que todo cuadre para sellar.

## Parte 2 — Cierre SELLADO

1. **Encabezado**: `OCOSINGO · SEPTIEMBRE 2026 · 🔒 SELLADO por <cerrado_por> el dd/mm hh:mm`
   (hora de `America/Mexico_City`).
2. **Rejilla de venta**: Persona, Meta, Capturó, Real SICAR, Diferencia (con los valores VIGENTES).
   En cada cifra rectificada: valor original tachado, debajo el vigente y la marca `rectificado`.
   **Cada cifra (meta, capturado, real SICAR) trae su botón `Rectificar`** que abre la ventana con
   `campo` fijo. Se elimina el `<select>` de "Campo".
3. **Elementos** (CierreElementos sellado): igual, botón `Rectificar` por cifra (meta, capturado/
   registrados, real) con `campo` fijo; conservar `clave`, `id`, `unidad` y la regla de
   `vigenteDeElemento`.
4. Panel de actividades desplegable igual que en la parte 1.
5. Lista de **Rectificaciones** como hoy (rótulo, de → a, motivo, quién y cuándo), en rejilla:
   Persona, Qué, Antes, Después, Motivo, Quién/cuándo.

**Ventana de rectificar**: título `Rectificar <qué> de <persona> · <mes en palabras>`, p. ej.
`Rectificar real de SICAR de Luis · septiembre 2026` o `Rectificar real de Yamaha de Ana · ...`.
Muestra `Valor actual: X` (formato de su unidad), campo `Valor nuevo`, `Motivo obligatorio`, botón
`Guardar rectificación`. La petición al servidor es EXACTAMENTE la de hoy
(`vendedor_id, campo, valor_nuevo, motivo` + `[clave]: id` para elementos).

## Parte 3 — Ventanas

`Modal` (DialogosObjetivos), cambios compatibles (las llamadas existentes siguen funcionando):
- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` al título.
- Tecla `Esc` cierra (llama `cerrar`).
- Foco inicial en el primer campo editable de la ventana (o en el botón principal si no hay).
- Prop opcional `error`: si viene, se muestra DENTRO de la ventana (`role="alert"`) arriba de los
  botones. En GerenciaVentas y CierreObjetivos, mientras una ventana está abierta, el error de la
  operación de esa ventana se pasa por `error` (además de donde ya se muestra, o en su lugar).
- Botones `type="button"`.

Ventana de **meta** (GerenciaVentas, `editando`): título `Meta de <persona> · <mes en palabras> ·
<tienda>` (tienda: `Meta de la tienda · septiembre 2026 · Ocosingo`). Si la meta ya existe:
`Meta actual: $X` como texto. Campo `Meta nueva`, `Motivo obligatorio` si existe, botón
`Guardar meta`. Ventana de **baja**: título `Dar de baja a <persona> · <tienda>`, campos como hoy,
botón `Registrar baja`.

Funciones puras nuevas (con pruebas):
- `mesEnPalabras("2026-09")` → `"septiembre 2026"` (sin depender de zona horaria).
- `contadorCierre(previo, valores)` → `{ total, capturados, conDiferencia }` según la parte 1.2
  (reutiliza `camposFaltantesCierre`, `llaveCampo`, `restarEnCentavos`; no redefine el universo).
- `rotuloCampoCierre({ campo, clave, grupo })` → `"meta" | "capturado" | "registrados" | "real de
  SICAR" | "real de la financiera"` para títulos de rectificar.

## Invariantes (revisar en la auditoría)

- Sellar sigue exigiendo todos los reales capturados (misma validación), NO exige diferencias en cero.
- Diferencias por persona siempre visibles; nunca solo un total.
- Rectificar solo anexa: el sellado original sigue visible (tachado) y la lista de rectificaciones
  completa.
- Personas dadas de baja o trasladadas siguen apareciendo en el cierre (se usa `previo`/`lineas` tal
  cual, sin filtrar por activos).
- Actividades siempre con "declaradas, no verificadas" y "no cuentan para la diferencia de SICAR".
- Motivo obligatorio en rectificar, meta existente y baja.
- Ninguna petición nueva al servidor.
- Líneas ≤ 200 caracteres; `className` largos a constantes. Acentos UTF-8 correctos: nada de "?"
  en lugar de "—", "✔", "–", "🔒", "🔓" o letras acentuadas (revisar el diff con `git diff` y buscar
  `"?"`).

## Pruebas y verificación

- TDD de `mesEnPalabras`, `contadorCierre` (persona sin elementos, con elementos, diferencia en
  centavos 0.1+0.2 vs 0.3, campos vacíos no cuentan como diferencia) y `rotuloCampoCierre`.
- `node --test src/` en verde; eslint sin errores; `npx vite build` OK.
- Navegador (Claude): cierre abierto con contador, faltantes en rojo, confirmación, sellar en copia
  local, sellado con rectificar por cifra, ventanas de meta/baja con títulos, Esc y error dentro.
