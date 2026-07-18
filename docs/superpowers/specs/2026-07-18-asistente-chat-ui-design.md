# Restyle del chat del Asistente de IA — Design

**Goal:** Dar al chat del Asistente de IA (`src/AsistenteIA.jsx`) una apariencia de app de mensajería real (inspirada en WhatsApp), reemplazando el look plano actual, sin tocar backend, datos, ni comportamiento.

**Contexto actual:** `AsistenteIA.jsx` ya renderiza burbujas de chat (verde esmeralda para el usuario, blanco con borde para la IA, con una esquina inferior recta simulando dirección) dentro de un contenedor `bg-slate-50`. Vive debajo del encabezado azul de `Dashboard.jsx` (que ya muestra el título "Asistente de Negocio"), así que este componente no necesita su propia barra de encabezado con nombre/avatar de "contacto" — eso ya lo cubre el Dashboard.

## Alcance

Solo `src/AsistenteIA.jsx`. Cambio puramente visual (JSX + clases de Tailwind). Sin cambios en:
- `backend/server.js` (ruta `/api/chat`, formato de request/response)
- Estado o lógica de `AsistenteIA.jsx` (`historial`, `enviar`, `Ticket`)
- Otros componentes

## Decisiones de diseño

1. **Color de burbujas propias:** azul de marca `#1a7fe8` (mismo tono que botones/encabezados del resto del sistema) en vez del verde esmeralda actual. Mismo estilo de "esquina recortada" que ya existe (no colita triangular tipo historieta — se descartó explícitamente por preferencia del usuario).
2. **Burbujas de la IA:** sin cambio de color (blanco, borde `slate-200`), solo la esquina recortada del lado opuesto, como ya está.
3. **Avatar del asistente:** un ícono circular pequeño (`Bot` de `lucide-react`, fondo azul claro, ícono azul) a la izquierda de cada burbuja de respuesta de la IA. Los mensajes del usuario no llevan avatar.
4. **Indicador de "escribiendo...":** los 3 puntos animados existentes se les agrega el mismo avatar circular a su izquierda, para que se vea como parte de la conversación en vez de flotar solo.
5. **Sin checkmarks de "leído" ni timestamps** — decisión explícita del usuario: no aplican a una conversación con una IA (no hay una segunda persona que "lea" el mensaje).
6. **Barra de texto inferior:** se mantiene con solo un `<input>` + botón de enviar (sin iconos decorativos de adjuntar/cámara/mic que no tendrían función real), pero con forma más redondeada tipo "pill" (`rounded-full` en vez de `rounded-xl`).
7. **Fondo del área de chat:** sin cambio (`bg-slate-50`, liso) — decisión explícita del usuario de no adoptar el tono cálido de la imagen de referencia.
8. **Consistencia de acento en toda la pantalla:** las burbujas de sugerencias iniciales (`SUGERENCIAS`) y el visor colapsable de "consulta" (`Ticket`, que muestra el JSON de debug de una consulta al DB) cambian su acento de verde esmeralda a azul de marca, para que la pantalla completa use un solo color de acento en vez de mezclar verde y azul. El estilo distintivo del `Ticket` (fuente monoespaciada, borde punteado) se mantiene igual — sigue siendo intencionalmente distinto de una burbuja de chat normal, porque es un visor de datos técnico, no un mensaje conversacional.

## Fuera de alcance (explícitamente descartado)

- Colita de burbuja triangular real (se prefirió mantener la esquina recortada actual).
- Checkmarks de "visto"/"entregado".
- Timestamps por mensaje.
- Iconos decorativos no funcionales (adjuntar, cámara, micrófono, emoji) en la barra de texto.
- Fondo con textura o tono cálido tipo WhatsApp.
- Cualquier cambio de backend o de la ruta `/api/chat`.

## Testing

No hay harness de pruebas automatizadas de frontend en este repo (convención ya establecida en el proyecto). Verificación manual:
- Correr el dev server localmente (`npm run dev` + backend con `DB_PATH` temporal aislado, nunca la base real).
- Confirmar visualmente cada punto de esta lista: color de burbujas, avatar solo en mensajes de la IA, indicador de "escribiendo" con avatar, ausencia de checkmarks/timestamps, forma de la barra de texto, acento azul en sugerencias y en el visor de `Ticket`.
- Capturar screenshots (vía Playwright, dado que la extensión Claude in Chrome no está disponible en este entorno) para confirmar con el usuario antes de dar el trabajo por terminado.
