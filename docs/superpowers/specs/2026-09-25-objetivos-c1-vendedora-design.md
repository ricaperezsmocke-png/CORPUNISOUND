# Entrega C1 — Pantallas de la vendedora estilo SICAR (Mi venta y Mis actividades)

Fecha: 2026-09-25. Diseño aprobado por Victor en conversación (partes 1 y 2, "si esta bien").
Rama `feature/objetivos-c1-vendedora`, base `e4bd7d6` (master con Entregas A y B en producción).

## Objetivo

Que la vendedora entienda su pestaña de un vistazo: la tarea del día arriba y en grande, el historial
abajo. **Solo reacomodo de pantalla.** No cambia ninguna regla, ruta, permiso ni dato del servidor.
Se usa en COMPUTADORA (no celular). Origen: análisis de Codex `analisis_ui_resultado.md` (puntos 2 y 3).

## Alcance

Archivos autorizados:
- `src/objetivos/CapturaVendedor.jsx` (reescritura de la presentación)
- `src/objetivos/ActividadesVendedor.jsx` (reescritura de la presentación; la lógica de guardar,
  confirmar conjunta, anular y agregar resultado se CONSERVA tal cual)
- `src/GerenciaVentas.jsx` SOLO para: pasar `verAvance={() => setPestana("mi-avance")}` a
  CapturaVendedor y ActividadesVendedor, y el título/contenido de la ventana de corregir captura.
- `src/objetivos/datos.js`, `src/objetivos/actividades.js` y sus `.test.js`: funciones puras nuevas.
- Nuevo opcional: `src/objetivos/Rejilla.jsx` (tabla con encabezado azul reutilizable) si simplifica.

Prohibido: todo `backend/`, `MarcasDelDia.jsx`, `CreditosVendedor.jsx`, pantallas de gerente, cierre,
`DialogosObjetivos.jsx` (se reutiliza `Modal`/`Campo` sin cambiarlos), dependencias nuevas, CSS global.

## Parte 1 — pestaña "Mi venta" (CapturaVendedor)

Orden de arriba abajo:

1. **Línea de resumen** (una sola línea, texto normal, no tarjetas):
   `Llevas $18,400.00 de $26,000.00 · 71 %` + enlace `Ver Mi avance →` (llama `verAvance`).
   Si la meta es 0 o no hay línea: `Llevas $X registrados` sin porcentaje (la respuesta no distingue
   meta ausente de meta 0; no inventar "sin meta"). Montos con centavos: usar `pesosConCentavos` de `src/objetivos/marcas.js` (`pesos` de datos.js
   redondea a pesos enteros y NO se cambia porque lo usan otras pantallas). Aplica a toda la parte 1.
2. **Bloque "Venta del día"** (bloque principal, cifra/campo grande). Solo si el mes NO está cerrado.
   - Día elegido = `fecha` (estado de GerenciaVentas). Título: `Venta de hoy · jueves 25 de septiembre`
     si `fecha === hoy`; si no, `Venta del 21/09`.
   - Enlace secundario `cambiar día` que muestra un `input type=date` (min primer día del mes, max
     hoy o fin de mes). Se conserva porque MarcasDelDia (debajo, sin cambios) usa esta misma `fecha`
     para capturar marcas de un día ya registrado.
   - Si ese día NO tiene captura de venta vigente: campo `Importe vendido` + botón `Guardar` +
     acción secundaria `No vendí nada ese día` (`capturar(0)`, igual que hoy).
   - Si ese día YA tiene captura vigente: `✔ Registraste $2,350.00` (o `✔ Registraste que no vendiste
     nada` si monto 0) + botón `Corregir` (abre la misma corrección de hoy). NO se muestra el campo.
   - Si el mes mirado no es el actual, el día por defecto sigue siendo el que ya pone GerenciaVentas
     (día 1); el título usa el formato `Venta del dd/mm`.
3. **Días pendientes**: si `dias_sin_capturar` está vacío → `✔ Estás al día` en VERDE. Si no →
   `⚠ Tienes N días sin capturar:` en ámbar, cada día como botón `dd/mm` que hace `setFecha(dia)`.
   Mes cerrado: los días se listan como texto, sin botones (igual que hoy).
4. **Historial**: rejilla estilo SICAR (encabezado azul `bg-blue-600 text-white`, filas alternas).
   Columnas: Fecha (dd/mm), Importe, Estado, Capturó, acción. Se conservan TODAS las marcas actuales:
   filas no vigentes en gris y tachadas con "Corregida", "Corrección vigente" con `Motivo: …`,
   `capturado N días después` en ámbar, botón `Corregir` solo en vigentes y mes abierto. Filtrar con
   `esCapturaDeVenta` como hoy.

**Ventana de corregir captura** (en GerenciaVentas): título `Corregir venta del dd/mm`; muestra
`Importe actual: $X` como texto; campo `Importe correcto`; `Motivo obligatorio`; botón
`Guardar corrección`. Para eso `corregir({ id, monto, motivo: "", fecha, montoAnterior })` desde
CapturaVendedor. La petición al servidor NO cambia (`{ monto, motivo }`).

Funciones puras nuevas (con pruebas):
- `ventaDelDia(capturas, fecha)` → la captura de venta VIGENTE de esa fecha o `null` (usa
  `esCapturaDeVenta`; ignora no vigentes y capturas de marca/producto).
- `resumenVenta({ meta, total })` → `{ texto, porcentaje|null }` según la regla del punto 1.
- `fechaCorta("2026-09-21")` → `"21/09"`; `fechaLarga("2026-09-25")` → `"jueves 25 de septiembre"`
  (sin depender de la zona horaria de la máquina: construir desde año/mes/día).

## Parte 2 — pestaña "Mis actividades" (ActividadesVendedor)

1. **Línea de avance**: por cada clase con meta > 0 o con registros, `Grupos 8 de 20` separadas por
   `·` (etiqueta corta = primera palabra significativa: Grupos, Marketplace, Iglesia, Volanteo — sale
   de un mapa por `clave`, no de cortar texto). Debajo o al lado, UNA sola vez: `(declaradas, no
   verificadas)` + enlace `Ver Mi avance →`. Sin meta (0) se muestra `Grupos 3` sin "de".
2. **Registrar actividad** (si el mes no está cerrado):
   - Las 4 clases del catálogo como **botones grandes** (con icono lucide: Megaphone, ShoppingBag,
     Church, FileText o similares existentes en lucide-react) en lugar del `<select>`; el elegido
     resaltado. Al cambiar de clase se limpia link/foto (igual que hoy).
   - Fecha: texto `Fecha: hoy, 25/09` + enlace `cambiar` que muestra el `input type=date` con los
     mismos min/max de hoy. Si el mes mirado no es el actual, se muestra el date desde el inicio.
   - Evidencia según la clase: link (url) o foto (mismo input, mismo `accept`, `capture`, 10 MB).
   - Nota detrás de `+ Agregar nota` (textarea igual que hoy, maxLength 300).
   - Botón `Guardar actividad`; el aviso de evidencia repetida y el botón `Sí, fue una actividad
     conjunta` se conservan EXACTAMENTE (misma detección del mensaje del servidor).
   - Mensaje de éxito: `Actividad registrada.` (el aviso ya está en la línea de avance).
3. **Mis registros**: encabezado `Mis registros · declaradas, no verificadas` y rejilla estilo SICAR:
   Fecha (dd/mm), Actividad, Evidencia (`Ver foto` → `drive_link` / `Ver publicación` → `link`,
   nueva pestaña, `noopener noreferrer`), Último resultado (`4 contactos, 1 cotización` o `—`),
   acciones. Debajo de la celda de actividad, en la misma fila: `Conjunta` y
   `registrado N días después` en ámbar cuando apliquen. Anulada: fila tachada gris con
   `Anulada: <motivo>` visible. Acciones (solo vigente y mes abierto): `Agregar resultado`, `Anular`
   (pueden ser botones de texto; no hace falta menú desplegable). Si hay más de un resultado:
   `Ver historial (N)` que despliega en la misma fila los anteriores con autor y fecha/hora.
4. El aviso `Declaradas, no verificadas` aparece como máximo: una vez en la línea de avance, una en
   el encabezado de registros y una dentro del diálogo de resultado. Nada por tarjeta ni por fila.

Funciones puras nuevas (con pruebas):
- `lineaAvanceActividades({ catalogo, metas, vendedorId, resumen, registros })` → arreglo
  `[{ clave, corta, declaradas, meta }]` solo de clases con meta > 0 o registros, en orden de catálogo.
- `ultimoResultado(registro)` → último elemento de `resultados` o `null` (no suma versiones).

## Lo que NO puede perderse (invariantes; revisar en la auditoría)

- Día sin captura ≠ día con venta 0. Nunca rellenar con cero.
- Correcciones y anulaciones siguen visibles (tachadas) con motivo; nada se borra de la vista.
- `capturado/registrado N días después` y `Conjunta` visibles en la fila.
- Motivo obligatorio al corregir y al anular.
- Confirmación manual de actividad conjunta; nunca automática.
- Mes cerrado = solo lectura (sin formulario, sin botones de acción).
- La vendedora solo ve lo suyo: no se agrega ninguna petición nueva al servidor.
- Líneas ≤ 200 caracteres; `className` largos a constantes. Acentos UTF-8 correctos.

## Pruebas y verificación

- TDD de las funciones puras en `src/objetivos/datos.test.js` y `src/objetivos/actividades.test.js`.
- `node --test src/` en verde; eslint sin errores nuevos; `npx vite build` OK.
- Prueba en navegador (Claude, Playwright) con la copia local: captura de hoy, día ya capturado
  muestra "Registraste" + Corregir con título con fecha, día pendiente, "Estás al día", registrar
  actividad con link y con foto, conjunta, anular, agregar resultado, mes cerrado de solo lectura.
