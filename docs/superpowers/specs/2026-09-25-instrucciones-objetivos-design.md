# Instrucciones en pantalla de "Mi Objetivo de Venta" y "Cierre de Objetivos"

Fecha: 2026-09-25. Formato (opción B) y TEXTOS aprobados por Victor ("ok para los textos de las instrucciones").
Rama `feature/instrucciones-objetivos`, base `9fdf45d`.

## Objetivo

Que las 3 personas nuevas de cada tienda sepan qué hacer en cada pestaña sin que nadie les explique.
**Solo presentación**: ninguna regla, ruta, permiso ni dato cambia. Se usa en COMPUTADORA.

## Dos piezas reutilizables (archivo nuevo `src/objetivos/Ayuda.jsx`)

1. **`FranjaAyuda({ clave, titulo = "¿Qué hago aquí?", children })`**: franja arriba de cada pestaña, fondo
   azul muy claro (`bg-blue-50 border border-blue-200 rounded-lg`), icono lucide `Info`, texto en lista
   numerada cuando son pasos. Botón ✕ con `aria-label="Cerrar instrucciones"`. Al cerrarse se recuerda
   en `localStorage` con la llave `ayuda_objetivos_<clave>` = "cerrada" (por computadora). Si se cerró,
   queda un enlace chico `¿Qué hago aquí?` que la vuelve a abrir (y borra la marca). TODO acceso a
   `localStorage` va en try/catch: si falla, la franja simplemente se muestra (nunca revienta la pantalla).
   La lógica de leer/escribir la marca va en funciones puras exportadas y probadas (p. ej.
   `franjaCerrada(storage, clave)`, `cerrarFranja(storage, clave)`, `abrirFranja(storage, clave)`),
   recibiendo el storage como parámetro para poder probarlas con un objeto falso y con uno que lanza.
2. **`AyudaBoton({ texto })`**: un "?" chico (círculo, `aria-label="Ayuda"`) junto a un botón o título.
   Al pasar el mouse O al recibir foco (teclado) muestra una burbuja con el texto; se oculta al salir /
   perder foco / Esc. Accesible: la burbuja con `role="tooltip"` y el botón con `aria-describedby`.
   No usar `title` como único mecanismo. Sin dependencias nuevas.

## Textos (VERBATIM, aprobados; respetar acentos y negritas)

### Vendedora

**Mi avance** (`AvanceVendedor.jsx`, clave `mi-avance`) — franja sin pasos:
> Aquí ves cómo vas en el mes. El anillo es tu porcentaje de la meta; la línea compara lo que llevas contra el ritmo que necesitas. El % de tu tienda es al cierre de ayer.

**Mi venta** (`CapturaVendedor.jsx`, clave `mi-venta`) — franja con pasos:
1. Al final del día escribe cuánto vendiste y presiona **Guardar**.
2. Si no vendiste nada, presiona **No vendí nada ese día**. No lo dejes en blanco: un día sin capturar cuenta como pendiente.
3. ¿Te faltó un día? Tócalo en la lista de días sin capturar.
4. ¿Te equivocaste? Usa **Corregir**: pide motivo y la versión anterior queda guardada.

"?" junto a:
- botón **Guardar** (venta del día): "Registra tu venta del día. Solo se captura una vez por día; para cambiarla usa Corregir."
- botón **Corregir** (el del bloque del día): "Cambia el importe. Tu jefa ve el motivo y el importe anterior."
- título de **Marcas del día** (`MarcasDelDia.jsx`): "Reparte tu venta del día entre las marcas que vendiste. La suma no puede pasar de tu venta."

**Mis actividades** (`ActividadesVendedor.jsx`, clave `mis-actividades`) — franja con pasos:
1. Elige qué hiciste: publicación en grupos, Marketplace, salida a iglesia o volanteo.
2. Pega el link de la publicación o sube la foto.
3. Presiona **Guardar actividad**. Después puedes agregar cuántos contactos y cotizaciones salieron.

y al final de la franja, sin número: "Las actividades son declaradas: tu gerente puede revisar la evidencia."

"?" junto a **Anular** (una sola vez, en el encabezado de la columna de acciones de "Mis registros", no en cada fila): "Quita la actividad de tu cuenta. Pide motivo y queda registrada como anulada."

**Mis créditos** (`CreditosVendedor.jsx`, clave `mis-creditos`) — franja sin pasos:
> Registra cada venta financiada con Coppel Pay o Atrato con su folio. El mismo folio no se puede registrar dos veces.

### Gerente

**Avance de la tienda** (`AvanceTienda.jsx`, clave `tienda-avance`):
> Cómo va la tienda y cada persona contra su meta. Úsalo para ver quién necesita apoyo.

**Venta de la tienda** (`RepartoGerente.jsx`, clave `tienda-venta`) — pasos:
1. **Fijar meta de tienda**: cuánto debe vender la tienda en el mes.
2. **Personal del mes**: quiénes trabajan este mes y desde qué día.
3. **Sugerir reparto** y presiona **Usar** en cada persona, o fija cada meta a mano.
4. Revisa arriba que diga **✔ Reparto completo**.

"?" junto a:
- **Sugerir reparto**: "Propone partes iguales. No guarda nada hasta que presiones Usar."
- **Dar de baja** (dentro de la ventana Personal del mes, una sola vez junto al título de la lista): "La persona deja de contar desde ese día; su historia se conserva."

**Actividades de la tienda** (`ActividadesGerente.jsx`, clave `tienda-actividades`):
> Toca una actividad para repartir su meta entre el personal. Abajo ves las actividades que declaró cada persona, con su evidencia.

**Marcas, productos y créditos** (`MarcasGerente.jsx`, clave `tienda-marcas`):
> Fija metas por marca (en pesos), por producto (en piezas) y por financiera. Las listas de marcas y productos se dan de alta aquí.

### Cierre de Objetivos (`src/CierreObjetivos.jsx`, clave `cierre`) — pasos, SOLO con el mes abierto:
1. Escribe el **real de SICAR** de cada persona, y el real de cada marca, producto y financiera.
2. Revisa las diferencias en ámbar.
3. Presiona **Revisar y cerrar** y confirma. **Sellar no se puede deshacer**: después solo se puede rectificar, con motivo.

Con el mes SELLADO no se muestra esa franja; en su lugar un "?" junto al título de la tabla de venta:
"Corrige una cifra del cierre sellado. El valor original queda visible, tachado." (texto de **Rectificar**).

## Reglas

- La franja va ARRIBA del contenido de cada pestaña, debajo de las pestañas; no empuja ni tapa botones.
- Un "?" por concepto, nunca repetido por fila de tabla.
- Nada de esto cambia qué ve cada rol: la franja de una pestaña solo aparece donde ya aparece la pestaña.
- Líneas ≤ 200 caracteres; `className` largos a constantes. Acentos UTF-8 correctos (nada de "?" en lugar de
  "—", "✔", "¿", "á", etc.; el "?" del botón de ayuda es un signo de interrogación de verdad, revísalo).
- Sin dependencias nuevas. Sin tocar backend.

## Pruebas

- TDD de las funciones puras de la marca de cerrado (storage falso, storage que lanza, abrir/cerrar/leer).
- `node --test src/` en verde; eslint sin errores; `npx vite build` OK.
- Navegador (Claude): cada pestaña muestra su franja; cerrar ✕ y recargar la deja cerrada; "¿Qué hago aquí?"
  la reabre; el "?" muestra su burbuja con mouse y con Tab; cierre abierto vs sellado.
