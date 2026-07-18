# Restyle del chat del Asistente de IA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar al chat del Asistente de IA (`src/AsistenteIA.jsx`) una apariencia de app de mensajería real: burbujas propias en azul de marca en vez de verde esmeralda, avatar circular junto a los mensajes de la IA, y acento azul consistente en el resto de los elementos de la pantalla (sugerencias, visor de consultas). Sin tocar backend, estado ni comportamiento.

**Architecture:** Un solo componente (`src/AsistenteIA.jsx`) recibe un restyle puramente presentacional: clases de Tailwind y un ícono nuevo (`Bot` de `lucide-react`) para el avatar. No se crean archivos nuevos, no cambia ninguna firma de función, no cambia el `DB`/estado/props.

**Tech Stack:** React 18 (`src/AsistenteIA.jsx`), Tailwind CSS, `lucide-react` (ya es dependencia existente del proyecto).

## Global Constraints

- Alcance limitado a `src/AsistenteIA.jsx` — no tocar `backend/server.js`, `src/Dashboard.jsx`, ni la ruta `/api/chat`.
- Color de marca a usar en todo el archivo: `#1a7fe8` (mismo azul que el resto del sistema usa en botones/encabezados) reemplazando el verde esmeralda (`emerald-600`/`emerald-700`) actual — el spec pide un solo color de acento consistente en toda la pantalla, no una mezcla.
- Sin colita de burbuja triangular (se mantiene la esquina recortada `rounded-br-sm`/`rounded-bl-sm` que ya existe) — decisión explícita del usuario.
- Sin checkmarks de "leído" ni timestamps por mensaje — decisión explícita del usuario.
- Sin iconos decorativos no funcionales (adjuntar/cámara/mic/emoji) en la barra de texto — decisión explícita del usuario.
- Fondo del área de chat sin cambio (`bg-slate-50`, liso) — decisión explícita del usuario.
- No hay harness de pruebas automatizadas de frontend en este repo — la verificación de este plan es manual, en navegador real, contra un backend con `DB_PATH` temporal aislado (nunca `backend/datos.sqlite` real).

---

### Task 1: Restyle completo de `src/AsistenteIA.jsx`

**Files:**
- Modify: `src/AsistenteIA.jsx` (único archivo tocado en todo el plan)

**Interfaces:**
- Consumes: nada nuevo — sigue usando `apiFetch` de `./api` exactamente igual que antes.
- Produces: nada consumido por otras tareas (este es el único task del plan).

- [ ] **Step 1: Agregar el ícono `Bot` al import de `lucide-react`**

Encuentra (línea 2):

```jsx
import { Send, ChevronDown, ChevronUp } from "lucide-react";
```

Reemplázalo con:

```jsx
import { Send, ChevronDown, ChevronUp, Bot } from "lucide-react";
```

- [ ] **Step 2: Cambiar el acento del componente `Ticket` (visor de consultas) de verde a azul**

Encuentra (dentro de `function Ticket`):

```jsx
      <button onClick={() => setAbierto((v) => !v)} className="w-full flex items-center justify-between px-3 py-2 text-emerald-700 font-semibold">
```

Reemplázalo con:

```jsx
      <button onClick={() => setAbierto((v) => !v)} className="w-full flex items-center justify-between px-3 py-2 text-[#1a7fe8] font-semibold">
```

- [ ] **Step 3: Agregar avatar circular a los mensajes de la IA y cambiar el color de las burbujas propias a azul**

Encuentra el bloque completo de renderizado de mensajes (dentro del `return` de `AsistenteIA`):

```jsx
        {historial.map((m, i) => (
          <div key={i} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
            <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap ${
              m.role === "user" ? "bg-emerald-700 text-white rounded-br-sm" : "bg-white border border-slate-200 rounded-bl-sm"
            }`}>
              {m.content}
            </div>
            {m.consultas?.map((c, j) => <Ticket key={j} input={c.input} resultado={c.resultado} />)}
          </div>
        ))}
```

Reemplázalo con (mueve `max-w-[85%]` al contenedor que agrupa avatar+burbuja, y agrega el avatar solo cuando `m.role === "assistant"`):

```jsx
        {historial.map((m, i) => (
          <div key={i} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
            <div className={`flex items-end gap-2 max-w-[85%] ${m.role === "user" ? "flex-row-reverse" : ""}`}>
              {m.role === "assistant" && (
                <div className="w-7 h-7 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                  <Bot size={15} className="text-[#1a7fe8]" />
                </div>
              )}
              <div className={`px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap ${
                m.role === "user" ? "bg-[#1a7fe8] text-white rounded-br-sm" : "bg-white border border-slate-200 rounded-bl-sm"
              }`}>
                {m.content}
              </div>
            </div>
            {m.consultas?.map((c, j) => <Ticket key={j} input={c.input} resultado={c.resultado} />)}
          </div>
        ))}
```

- [ ] **Step 4: Agregar el mismo avatar al indicador de "escribiendo..."**

Encuentra:

```jsx
        {enviando && (
          <div className="flex items-start">
            <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1">
              {[0, 1, 2].map((i) => (
                <span key={i} className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        )}
```

Reemplázalo con:

```jsx
        {enviando && (
          <div className="flex items-end gap-2">
            <div className="w-7 h-7 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
              <Bot size={15} className="text-[#1a7fe8]" />
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1">
              {[0, 1, 2].map((i) => (
                <span key={i} className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        )}
```

- [ ] **Step 5: Cambiar el acento hover de las burbujas de sugerencias de verde a azul**

Encuentra:

```jsx
              className="text-xs bg-white border border-slate-200 rounded-full px-3 py-1.5 hover:border-emerald-600 hover:text-emerald-700 transition-colors"
```

Reemplázalo con:

```jsx
              className="text-xs bg-white border border-slate-200 rounded-full px-3 py-1.5 hover:border-[#1a7fe8] hover:text-[#1a7fe8] transition-colors"
```

- [ ] **Step 6: Restilizar la barra de texto inferior (forma de píldora + acento azul)**

Encuentra:

```jsx
          <input
            value={entrada}
            onChange={(e) => setEntrada(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && enviar(entrada)}
            placeholder="Pregunta algo sobre tu negocio..."
            className="flex-1 border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-600"
          />
          <button
            onClick={() => enviar(entrada)}
            disabled={enviando}
            className="bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 text-white rounded-xl px-4 flex items-center justify-center"
          >
            <Send size={17} />
          </button>
```

Reemplázalo con:

```jsx
          <input
            value={entrada}
            onChange={(e) => setEntrada(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && enviar(entrada)}
            placeholder="Pregunta algo sobre tu negocio..."
            className="flex-1 border border-slate-300 rounded-full px-4 py-2.5 text-sm focus:outline-none focus:border-[#1a7fe8]"
          />
          <button
            onClick={() => enviar(entrada)}
            disabled={enviando}
            className="bg-[#1a7fe8] hover:bg-[#1262b8] disabled:bg-slate-300 text-white rounded-full px-4 flex items-center justify-center"
          >
            <Send size={17} />
          </button>
```

- [ ] **Step 7: Build de frontend limpio**

Run: `npm run build`
Expected: build exitoso sin errores (`✓ built in ...`), sin warnings nuevos de Tailwind/JSX.

- [ ] **Step 8: Verificación manual en navegador real**

No hay harness de pruebas de frontend en este repo — verificación manual contra un backend con `DB_PATH` temporal:

```bash
cd backend && DB_PATH=<ruta-temporal> PORT=<puerto-libre> node server.js
# en otra terminal, desde la raíz del repo:
VITE_API_URL=http://localhost:<puerto-libre>/api npm run dev -- --port <otro-puerto-libre>
```

Con Playwright + Chromium real (o manualmente en el navegador):
1. Inicia sesión (crea el admin inicial si la DB temporal está vacía) y entra al Dashboard — el Asistente de IA se ve en la parte de abajo.
2. Confirma que el mensaje de bienvenida de la IA muestra el avatar circular azul con el ícono `Bot` a su izquierda.
3. Escribe un mensaje y envíalo — confirma que tu burbuja se ve en azul de marca (`#1a7fe8`), alineada a la derecha, sin avatar.
4. Mientras la IA responde, confirma que el indicador de "escribiendo..." (3 puntos) también muestra el avatar circular azul a su izquierda.
5. Confirma que la respuesta de la IA se ve en una burbuja blanca con borde, con el avatar a su izquierda.
6. Si la respuesta incluye una consulta (`Ticket`), ábrela y confirma que el texto "🧾 consulta: ..." se ve en azul (no verde).
7. Confirma que ninguna burbuja tiene checkmarks ni timestamp.
8. Con el historial en su estado inicial (antes de enviar el primer mensaje), confirma que las burbujas de sugerencias (`SUGERENCIAS`) cambian a borde/texto azul al pasar el mouse encima (no verde).
9. Confirma que la barra de texto inferior tiene forma de píldora (bordes totalmente redondeados) y que el botón de enviar es azul.
10. Confirma visualmente que no aparece ningún ícono de adjuntar/cámara/mic/emoji en la barra de texto.

Captura screenshots de cada paso relevante y compáralos contra la lista de decisiones del spec (`docs/superpowers/specs/2026-07-18-asistente-chat-ui-design.md`) antes de dar el trabajo por terminado.

Detén ambos servidores y borra la base de datos temporal al terminar.

- [ ] **Step 9: Commit**

```bash
git add src/AsistenteIA.jsx
git commit -m "style: restyle del chat del Asistente de IA a azul de marca con avatar"
```

---

## Self-Review Notes

- **Cobertura del spec:** color de burbujas propias (Step 3), avatar de la IA (Steps 3-4), sin checkmarks/timestamps (no se agregó ninguno en ningún step — confirmado por omisión intencional), barra de texto sin iconos decorativos y en forma de píldora (Step 6), fondo sin cambio (ningún step toca `bg-slate-50` del contenedor raíz), acento azul consistente en `Ticket` y sugerencias (Steps 2 y 5).
- **Sin placeholders:** cada step tiene el código exacto de "antes" y "después", tomado directamente del archivo actual.
- **Consistencia de tipos/nombres:** no se introduce ninguna función, prop o variable nueva más allá del ícono `Bot` importado en el Step 1 y usado en los Steps 3-4 — mismo nombre en ambos usos.
- **Un solo task** porque es un cambio cohesivo de un único archivo sin partes independientemente aprobables/rechazables — todos los cambios visuales forman una sola entrega coherente (el restyle completo de la pantalla).
