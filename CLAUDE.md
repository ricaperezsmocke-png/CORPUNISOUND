# CORPUNISOUND — instrucciones para agentes

Sistema de punto de venta de **Unisound**, cadena de tiendas de instrumentos musicales en Chiapas,
México. Sucursales: 1 Ocosingo, 2 Yajalón, 3 San Cristóbal, 4 Palenque, 5 MercadoLibre (virtual),
6 CEDIS (virtual).

**Victor, el dueño, no es programador.** Dirige el trabajo y toma las decisiones de negocio, pero no
puede leer el código para verificar lo que le entregas. Eso cambia dos cosas: los informes tienen que
estar escritos para él —qué pasa, a quién le pasa, cuánto cuesta—, y **no puedes darte el lujo de
entregar algo sin verificar**, porque nadie más lo va a atrapar.

Esto es dinero real de un negocio real. Un error aquí no es un test rojo: es una cajera cargando con
un faltante que no cometió.

---

## Lo que no se hace nunca

- **No agregar dependencias.** Ninguna. Las pruebas usan el runner integrado de Node (`node --test`).
  Si crees que necesitas una, detente y pregunta.
- **No `git add .`** — el repo tiene ~527 archivos sin seguimiento (`.agents/`, `graphify-out/`,
  `skills-lock.json`). Siempre staging por rutas explícitas.
- **No push, no merge, no rebase.** Eso lo hace Victor, siempre. Commits en la rama de trabajo, sí.
- **No subir archivos al disco de Render.** Todo lo que sea archivo va a Drive: el disco de Render se
  llena y apaga los respaldos.
- **No tocar `render.yaml`** salvo que se te pida explícitamente. Durante un mes declaró un plan que
  no era el real y una resincronización habría borrado el disco con toda la base.

---

## Comandos

```bash
cd backend && node --test          # suite completa (~1250 pruebas, ~100 s)
cd backend && node --test x.test.js  # un archivo
npx eslint src backend             # 0 errores; los ~455 warnings son preexistentes
cd backend && node server.js       # backend en :4000
npx vite --port 5173               # frontend
```

**La línea base es 0 fallas y 0 errores de eslint.** Si tu cambio baja ese número, no está terminado.

---

## Las reglas de dinero

Estas cinco han costado sesiones enteras de diagnóstico. No las redescubras.

**1. Toda validación de dinero va en el SERVIDOR.** Una comprobación que solo vive en `src/` no es
una comprobación: es una sugerencia. Quien manda la petición a mano se la salta. Ya pasó con el
precio de venta (el servidor copiaba el total que mandaba el navegador) y con el descuento.

**2. Las guardas fallan CERRANDO, no abriendo.** Valida contra la lista de lo permitido, no contra la
de lo prohibido. La guarda del crédito comparaba contra "CREDITO" normalizando el acento; una
petición con el cuerpo mal codificado llegaba como `CR�DITO`, no coincidía con nada, y la venta
a crédito **entraba**. Ninguna prueba lo encontró: todas mandan texto bien formado.

**3. `esDeEstaCaja` (`backend/cajas.js`) es la ÚNICA definición de "este movimiento es de esta
caja".** La usan ventas, abonos, gastos y cortes. Una comparación suelta de `caja_id` en cualquier
otro lado esconde las ventas históricas (`caja_id: null`) que el corte de la Administrativa sí cobra
— y quien investiga un faltante no ve las ventas que le están cobrando.

**4. Los ids que llegan del cuerpo HTTP pueden ser TEXTO.** `"9" === 9` es falso, y un guard que
compara con igualdad estricta falla **abriendo**. Normaliza con `Number(...)` antes de comparar,
cuidando que `Number(null)` es `0`.

**5. El selector de sucursal del encabezado es un FILTRO de listas, nunca la fuente del alcance.**
`apiFetch` (`src/api.js`) inyecta `sucursal_id` y `caja_id` desde `localStorage` en toda petición que
no los traiga. Un guard que resuelva el alcance desde `?sucursal_id=` acaba escondiéndole al
administrador registros que sí ve en la lista de al lado. **Ya mordió cuatro veces.** Para un guard
por `:id`, resuelve el alcance solo de quien pregunta: su permiso `ver_todas_las_sucursales` y la
`sucursal_id` de su token. Y cuidado con que la sucursal salga del token mientras la caja sale del
encabezado: son dos fuentes para una sola decisión, y revienta.

**Estado actual:** las ventas a crédito están **apagadas** a propósito. El sistema aceptaba la venta
pero nunca generaba la deuda (`cliente.saldo` se inicializa en cero y nadie lo sube). Se vuelven a
encender el día que existan cuentas por cobrar de verdad.

---

## Fechas

- **Fechas solas** (`fecha`): `fechaLocal()` de `backend/fechas.js`, zona `America/Mexico_City`.
- **Marcas completas** (`fecha_hora`): ISO en UTC, a propósito.

No mezclar. Los datos anteriores al 2026-08-04 conservan su fecha corrida; no se migraron.

---

## Permisos

Hay un guard de arranque (`validarSistemaDePermisos`) que **tumba el backend** si un módulo no está
registrado. Todo módulo o permiso nuevo se da de alta en `backend/permisosCatalogo.js`, y la ruta usa
**su** permiso, nunca uno prestado de otro módulo.

El rol Administrador se reconcilia solo contra el catálogo en cada arranque. Los demás roles no: si
un permiso nuevo debe llegarle a un gerente o a una cajera, Victor tiene que dárselo a mano en Roles
y Personal.

---

## Cómo escribir pruebas aquí

Esto bloqueó un despacho completo de trabajo. Las firmas y helpers **reales**:

```js
crearVenta(DB, datos)                 // DOS argumentos
crearCliente(DB, datos)               // DOS
actualizarCliente(DB, id, datos)      // TRES: sin usuario y sin alcance
```

- **`backend/testHelpers.js` exporta solo `construirDBPrueba` y `sembrarCuentas`.** No existen
  `datosVentaDePrueba`, `usuarioDePrueba`, `driveFalso` ni nada parecido: **no los inventes**.
- El patrón es un `prepararDB()` local dentro del propio archivo de prueba. Cópialo de
  `backend/cajas.test.js`.
- Una línea de venta es `{ descripcion, cantidad, precio_unitario }` — `precio_unitario`, no `precio`.
  Las líneas **sin `producto_id`** son productos rápidos: no tienen catálogo contra el cual validar.
- **Verifica que la prueba se pone ROJA antes de implementar.** Una prueba que nunca falló no prueba
  nada. Si mutas código para comprobarlo, revierte la mutación **en el mismo turno**: ya van dos
  sesiones muertas dejando código mutado sin commitear, y una costó una sesión entera de diagnóstico.
- Una prueba de permisos con un rol de `permisos: []` **no prueba el permiso**: pasaría con cualquier
  clave. Dale permisos vecinos del mismo módulo.

---

## Flujo de trabajo

`docs/superpowers/specs/` y `docs/superpowers/plans/` — **léelos antes de rehacer trabajo.** Hay
specs y planes escritos para cosas que todavía no se implementan.

Para trabajo grande: spec → plan → implementación por tareas con TDD → **revisión independiente** →
prueba en navegador → Victor mergea.

**Nadie valida su propio trabajo.** Quien implementa no revisa. Y si el trabajo lo hizo Codex, la
revisión no puede ir a Codex.

**Una rama = un worktree = un solo responsable de escritura.** Antes de despachar a alguien: confirma
rama, worktree, commit base y `git status` reales — no los asumas por la conversación.

**Al retomar una sesión que se cortó:** `git status`, `git diff`, corre la suite, y
`grep -n "if (false" backend/*.js` buscando mutaciones vivas, ANTES de diagnosticar nada.

**Mensajes de commit sin acentos** (el terminal de Windows los rompe). En el código y en la interfaz,
los acentos sí van.

---

## La prueba en navegador no es un trámite

Es lo único que ninguna prueba automática cubre, y es donde han aparecido los defectos más caros. El
sistema tiene **Claude in Chrome** disponible: úsalo. Levanta el backend y el frontend, entra, y haz
el flujo completo como lo haría una cajera.

Al entrar, el login pide GPS y espera hasta 10 segundos antes de continuar: si la pantalla se queda
en "Entrando…", **espera**, no está colgada.

Y si la interfaz te bloquea, ataca la API directamente con `curl`: `POST /api/auth/login` te da el
token. Así fue como apareció el agujero del crédito que la pantalla escondía.

---

## Deuda conocida

- **Nadie ha probado en navegador** el módulo de Garantías completo, los Gastos con comprobante, ni
  el reporte de Gastos de Garantías.
- **Los gastos de garantía no entran en ningún corte** y el dinero del cliente sí pasa por la caja:
  hay un plan escrito para arreglarlo.
- **El dinero de un apartado cancelado** se convierte en `monedero`, un saldo que no se puede gastar
  en ninguna parte.
- **`precio_lista` del cliente no se lee nunca**: el POS usa siempre `producto.precio_venta`.
