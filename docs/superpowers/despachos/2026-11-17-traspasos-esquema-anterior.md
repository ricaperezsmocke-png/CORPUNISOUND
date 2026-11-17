# Despacho: traspasos SICAR del esquema anterior (Yajalón) + resumir los avisos de omitidos

**Rama:** `fix/traspasos-esquema-anterior` — **worktree:**
`C:\Users\Victor\Desktop\CORPUNISOUND\.claude\worktrees\seguimiento-mejoras` — **commit base:** el HEAD de la rama al
recibir este despacho (árbol limpio, = master `0ff6ddd`). Un solo responsable de escritura: tú. Lee primero `CLAUDE.md`
de la raíz y `agente-sicar/LEEME.md` (sección de traspasos).

**Pruebas (obligatorio con estas banderas), desde la raíz del worktree:**
- Agente: `cd agente-sicar && node --preserve-symlinks --preserve-symlinks-main --test formato.test.js corrida.test.js
  contrato.test.js estado.test.js`
- Servidor: `cd backend && node --preserve-symlinks --preserve-symlinks-main --test sicarRepositorio.test.js
  sicarTraspasos.test.js sicarIngesta.test.js ../src/sicar/traspasosSicar.test.js` (si `sicarIngesta.test.js` no existe
  con ese nombre, usa el archivo donde ya se prueban `traspasos_omitidos`).
Si alguna falla con EPERM al crear temporales en tu sandbox, escribe la prueba igual y reporta cuál no pudiste correr.
NO corras la suite completa. Al final `npx eslint src backend agente-sicar --quiet`: 0 errores.
No puedes hacer `git add`/`commit`: deja los cambios en el árbol. NO abras navegador ni levantes servidores.

## Contexto de negocio (medido en la base SICAR de Yajalón el 2026-11-17, solo lectura)

La pantalla "Traspasos SICAR" muestra 524 avisos rojos "Traspaso SICAR #N de Yajalón no llegó al sistema: Estado
desconocido en SICAR" (ids #2 a #525). Causa: son traspasos de 2015 a agosto de 2023 guardados con un **esquema anterior
de SICAR**; su `traspaso.status` es `-4` (428, todos con `fechaApl`), `-3` (89, todos con `fechaCan`) o `-2` (7, sin
ninguna de las dos fechas), y casi todos van entre la sucursal SICAR `-2` y la `1`. Desde el tra_id 526 (septiembre
2023) solo existen `2`, `1` y `-1`, que el agente ya entiende (`agente-sicar/formato.js:274`). El agente rechaza todo
lo demás con `ESTADO_TRASPASO_DESCONOCIDO` y el servidor lo guarda en `sicar_traspasos_omitidos` como alerta.

**Decisión de Victor (2026-11-17):** esos traspasos son historia vieja; **el agente los reconoce como "esquema
anterior" y no los manda como traspaso ni como alerta**, y las 524 alertas que ya están en el servidor se borran.
Siguen existiendo en SICAR como siempre. **No** se traducen a recibido/cancelado/enviado (eso metería la sucursal `-2`
al mapa y 7 envíos de hace años como "sin recibir").

Además, para cualquier tienda en el futuro: la misma pantalla pinta **un renglón rojo por omitido**; con cientos tapan
la pantalla. Se resume en un renglón por tienda + motivo (Parte 2).

## Parte 1 — Esquema anterior (TDD: cada prueba se ve ROJA antes de implementar)

1. **Agente, `formato.js`:** nueva constante `ESTADOS_TRASPASO_ANTERIOR = new Set(['-4', '-3', '-2'])` junto a
   `ESTADOS_TRASPASO`, comentada con lo medido arriba. En `traspaso(...)`, si `String(t.status)` está en ese conjunto,
   lanza `Error('TRASPASO_ESQUEMA_ANTERIOR')` **antes** de cualquier otra validación (fecha, detalle, ids: esos datos
   viejos pueden venir raros y no importa). Agrégalo a `DATOS_RAROS` y donde haga falta para que `traspasoSeguro`
   devuelva `omitido: { tra_id, codigo: 'TRASPASO_ESQUEMA_ANTERIOR' }` y la corrida siga (revisa también la lista
   `FALLOS` de `estado.js`). Cualquier otro status desconocido (0, 3, `-5`, texto, null) sigue siendo
   `ESTADO_TRASPASO_DESCONOCIDO` exactamente como hoy.
2. **Agente, `corrida.js` `leerPagina`:** el omitido con ese código **sí** viaja en `traspasos_omitidos` con su código
   (así el servidor borra la alerta vieja y el cursor/huella avanzan igual que hoy), pero **no** escribe una línea por
   traspaso en la bitácora: en lugar de `avisarUnaVez('TRASPASO_OMITIDO', tra_id, ...)` usa un solo
   `avisarUnaVez('TRASPASOS_ESQUEMA_ANTERIOR')` (o el mecanismo equivalente que ya exista para avisos sin id), que salga
   una vez por corrida a lo mucho. Si `avisarUnaVez` exige que el evento esté registrado en una lista (`EVENTOS` u otra),
   regístralo.
3. **Servidor, `backend/sicarRepositorio.js`:** en el bucle de `lote.traspasos_omitidos` (~línea 643), si
   `o.codigo === 'TRASPASO_ESQUEMA_ANTERIOR'` **borra** la alerta de ese `(sucursal_id, tra_id)` con
   `borrarTraspasoOmitido` y **no** inserta nada. Agrega el código a `CODIGOS_TRASPASO_OMITIDO` solo si hace falta para
   la validación; nunca debe terminar guardado como alerta (ni como `OTRO`). Los demás códigos, igual que hoy.
   `sicarIngesta.js` no cambia (el contrato `{ tra_id, codigo }` ya lo acepta). Ojo: un servidor viejo guardaría el
   código nuevo como `OTRO`; por eso el servidor se despliega antes que el agente (lo hace Claude).
4. **`agente-sicar/LEEME.md`:** un párrafo en la sección de traspasos explicando los estados -4/-3/-2 del esquema
   anterior y qué hace el agente con ellos.

### Pruebas mínimas Parte 1

- `formato`: status `-4`, `-3`, `-2` (número y texto) → omitido con `TRASPASO_ESQUEMA_ANTERIOR`, aunque la fecha o el
  detalle vengan inválidos; status `0`, `3`, `-5`, `null` → `ESTADO_TRASPASO_DESCONOCIDO` como hoy; `2`/`1`/`-1` igual.
- `corrida`: una página con un traspaso válido y dos del esquema anterior → el lote trae el válido en `traspasos` y los
  dos en `traspasos_omitidos` con el código nuevo; el cursor avanza; la bitácora no tiene una línea `TRASPASO_OMITIDO`
  por cada uno.
- `sicarRepositorio`: con una alerta previa `ESTADO_TRASPASO_DESCONOCIDO` del tra 2, un lote con
  `{ tra_id: '2', codigo: 'TRASPASO_ESQUEMA_ANTERIOR' }` la borra y no deja fila; un omitido con otro código sigue
  guardándose; un código desconocido sigue quedando como `OTRO`.

## Parte 2 — Resumir los avisos de omitidos en pantalla (TDD)

Cada omitido llega del servidor así (no cambia): `{ sucursal_id, tienda, tra_id, codigo, motivo, primera_vez,
ultima_vez }` (`tra_id` es texto; `tienda` puede faltar). Hoy `OmitidosArriba` (`src/sicar/TraspasosSicar.jsx`
~líneas 66-75) pinta un renglón por omitido con `textoOmitido` (`src/sicar/traspasosSicar.js`).

1. **Función pura nueva** en `src/sicar/traspasosSicar.js`: `agruparOmitidos(omitidos)` → arreglo de grupos, uno por
   **tienda + motivo** (misma `sucursal_id` y mismo `codigo`; si falta `codigo`, agrupa por el texto de `motivo`):
   `{ clave, sucursal_id, tienda, codigo, motivo, cantidad, ids, rango, desde, texto }`.
   - `ids`: los `tra_id` ordenados **numéricamente** cuando todos son enteros no negativos (`/^\d+$/`; compara por
     longitud y luego texto, o BigInt; nunca `Number` a ciegas); si alguno no lo es, orden de texto estable.
   - `rango`: `{ primero, ultimo }` **solo si** todos son enteros, consecutivos sin huecos y hay 2 o más; si no, `null`.
   - `desde`: la `primera_vez` más antigua del grupo (ISO) o `null`.
   - `texto`, exactamente:
     - Un solo traspaso: `textoOmitido(o)` (no cambia).
     - Varios con rango: `"Yajalón: 524 traspasos SICAR no llegaron al sistema (#2 a #525): Estado desconocido en SICAR.
       Revísalos en SICAR."`
     - Varios sin rango: `"Yajalón: 7 traspasos SICAR no llegaron al sistema: Estado desconocido en SICAR. Revísalos en
       SICAR."`
     - Tienda sin nombre: `Tienda <sucursal_id>` (como hoy). Motivo ausente: el mismo texto por defecto de hoy.
   - Orden de grupos: por nombre de tienda, luego por motivo. `null`/`undefined`/vacío → `[]`. No muta la entrada.
2. **Pantalla** (`OmitidosArriba`): un renglón rojo por **grupo** con su `texto`. Si el grupo tiene más de uno, debajo
   un `<details>` plegado con `<summary>` "Ver los N traspasos" que lista los ids (`#2, #3, #4…`) en una caja con alto
   máximo y desplazamiento propio (`max-h-40 overflow-y-auto`, extraído a constante si la línea crece). Si `desde`
   existe, el renglón añade " Detectados desde el DD/MM/AAAA." con fecha local (reutiliza el helper de fecha que ya use
   ese archivo o `src/fechas.js`; no inventes otro). Sigue siendo `role="alert"`, rojo, y visible sin importar los
   filtros. `resumenDeAlertas` no cambia.

### Pruebas mínimas Parte 2

- 524 omitidos de una tienda, ids "2".."525" desordenados, mismo código → 1 grupo, `cantidad` 524, `rango` 2-525 y el
  texto exacto. Mismo caso sin el "300" → `rango` null y texto sin paréntesis.
- Dos tiendas, o una tienda con dos códigos → grupos separados y en orden. Un solo omitido → texto = `textoOmitido`.
- Ids no numéricos o mezclados → no truena, `rango` null. "10" va después de "9". `desde` = la más antigua.
  Vacío/null → `[]`. No muta la entrada.

## Archivos autorizados

`agente-sicar/formato.js`, `agente-sicar/corrida.js`, `agente-sicar/estado.js` (solo registrar el código/evento),
`agente-sicar/LEEME.md`, y sus `.test.js` (`formato`, `corrida`, `estado`, `contrato` si hace falta);
`backend/sicarRepositorio.js` (solo el bucle de omitidos y el conjunto de códigos) y `backend/sicarRepositorio.test.js`
(o el archivo donde ya se prueba la ingesta de `traspasos_omitidos`); `src/sicar/traspasosSicar.js`,
`src/sicar/traspasosSicar.test.js`, `src/sicar/TraspasosSicar.jsx`.
**Prohibido** todo lo demás: `mapeo.js` (las consultas no cambian), `sicarIngesta.js`, `sicarTraspasos.js`, `server.js`,
`seguimientoFactura/*`, `render.yaml`, `config.json` de cualquier lado.

## Reglas

- Sin dependencias nuevas. Ninguna línea de más de 200 caracteres. Acentos en UTF-8 real (sin `Ã³` ni `�`).
- El agente es solo lectura sobre SICAR: no cambies consultas ni agregues ninguna.
- Si mutas código para ver una prueba roja, revierte en el mismo paso.

## Detente y reporta (no improvises) si

- Hace falta tocar un archivo prohibido, o el mecanismo de huellas/cursor de traspasos tiene que cambiar.
- Una prueba existente cambia de expectativa (salvo agregar el código nuevo a una lista exacta de códigos/eventos: eso
  está autorizado; lístalo).

## Entrega

Conteo de pruebas por archivo, evidencia rojo→verde, eslint, `git status --short`, `git diff --stat`, pruebas que no
pudiste correr, pruebas existentes que ajustaste, y qué hay que mirar en el navegador. Confirma que no dejas procesos
corriendo.
