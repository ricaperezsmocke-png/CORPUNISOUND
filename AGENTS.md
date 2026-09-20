# CORPUNISOUND — reglas para cualquier agente que toque este código

Este archivo existe para que **Codex y cualquier otro agente** lean las mismas reglas que Claude.

**Las reglas completas están en `CLAUDE.md`, en la raíz del repo. Léelo.** Aquí quedan solo las que
no se negocian nunca, para que nadie pueda decir que no las vio.

---

## Este sistema cobra dinero de verdad

Es el punto de venta de **Unisound**, una cadena de tiendas de instrumentos musicales en Chiapas.
Ahí se cobra, se corta caja, se lleva inventario y se paga. **Victor, el dueño, no programa:** no
puede leer el código para verificar lo que le entregas, así que nadie va a atrapar tu error después.

Un error aquí no es una prueba en rojo: es una cajera cuadrando su cajón a la que el sistema le dice
que le falta dinero que nunca tuvo.

---

## Lo que no se hace nunca

- **Ninguna dependencia nueva.** Ninguna. Las pruebas usan el runner de Node (`node --test`). Si
  crees que hace falta una, detente y pregunta.

- **Ninguna línea de más de 200 caracteres** en `.js` ni `.jsx` de `src/` o `backend/`.
  Este repo llegó a tener una línea de **2,658 caracteres**: una pantalla entera de React en un solo
  renglón. Ahí es donde se esconden los errores caros. Si una línea no cabe, se parte. Si de verdad
  no se puede partir, se reporta y se explica por qué; no se escribe igual y se sigue.
  Un `className` de Tailwind largo no es excusa: se extrae a una constante.
  Claude tiene esto bloqueado por un hook y no puede saltárselo. **Codex escribe archivos por su
  cuenta, así que aquí depende de que lo respetes solo.**

- **No `git add .`** — hay cientos de archivos sin seguimiento. Staging por rutas explícitas.

- **No push, no merge, no rebase.** Eso lo autoriza Victor. Commits en la rama de trabajo, sí.

- **No tocar `render.yaml`** salvo que se pida explícitamente: una resincronización mal hecha puede
  borrar el disco donde viven todos los datos del negocio.

- **No subir archivos al disco de Render.** Todo archivo va a Drive; el disco se llena y apaga los
  respaldos.

---

## Cómo se prueba aquí

```
node --preserve-symlinks --preserve-symlinks-main --test backend/<archivo>.test.js
```

**Las dos banderas son obligatorias en Windows.** Sin ellas Node resuelve los enlaces de
`node_modules` y truena con `EPERM`, y parece que el entorno está roto cuando no lo está.

**No corras la suite completa desde un worktree:** se arrastra. La suite completa y los commits los
hace Claude.

**La prueba se escribe ANTES y se comprueba que falla.** Una prueba que nunca estuvo en rojo no
prueba nada.

---

## Cuando algo no está escrito

Si te topas con una decisión de negocio que no está en el spec, en el plan ni en tu contrato:
**detente y repórtalo.** No la inventes.

Detenerse con una buena razón es una entrega válida y esperada. Inventar una regla de negocio en un
sistema que cobra dinero, no.
