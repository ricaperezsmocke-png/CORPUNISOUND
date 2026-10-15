# Despacho: agente SICAR de tienda (F4) — Ocosingo primero

**Para:** Codex (implementación con TDD). **Revisa:** Claude. **Merge/push/instalación:** Victor.

## 1. Lugar de trabajo

- Repo: CORPUNISOUND. Rama `feature/agente-sicar`, worktree `.claude/worktrees/agente-sicar`.
- Commit base: `ef6bd08` (master = origin/master). Este archivo es el primer commit de la rama.
- Un solo responsable de escritura: tú. No toques otros worktrees.

## 2. Objetivo

Construir el programa que corre en la PC de una tienda (primero Ocosingo, donde está el MySQL de
SICAR), lee clientes y ventas de SICAR **solo leyendo**, y los manda a producción con el contrato v1:
`docs/sicar-contrato-v1.md`. El servidor ya está construido y en producción; el contrato lo prueba
`backend/sicarContrato.test.js`. Léelos completos antes de empezar, junto con las secciones 6, 14 y 15
de `docs/superpowers/plans/2026-10-13-crm-clientes-sicar.md`.

Hoy en producción no hay ni un cliente de SICAR. Victor quiere ver **toda** la base de Ocosingo:
5,097 clientes con nombre (aunque nunca hayan comprado), 10,918 ventas con nombre, ~24 mil renglones.

## 3. Decisiones ya tomadas por Victor (no las reabras)

1. **Usuario MySQL: `consultas`.** SICAR no le da la contraseña root, así que no se puede crear un
   usuario de solo lectura. Ese usuario tiene `FILE ... WITH GRANT OPTION` y MySQL escucha en todas
   las interfaces. Victor acepta conectarse con él. **La protección contra escribir tiene que estar en
   el agente** (sección 5). Actualiza la sección 6 de `docs/sicar-contrato-v1.md` para que diga eso
   en vez de "no conectar".
2. **Dependencia autorizada: `mysql2`, versión exacta `3.24.5` (subida desde 3.15.3 el 2026-10-15 por dos avisos de seguridad)**, solo dentro de `agente-sicar/`.
   Ninguna otra dependencia, en ningún lado. HTTP con el `fetch` integrado de Node (Node >= 20).
3. Se construye en este repo, carpeta nueva `agente-sicar/`, con su propio `package.json`.
4. Público en general **no se manda** (cli_id 1, 2, 3, 13, 21, 33, 4566, 4567, 4572 en Ocosingo, o nombre
   `^P.BLICO EN GENERAL`). El servidor lo descarta igual, pero el agente no debe mandarlo.
5. Carga histórica **solo de 20:00 a 07:00** (hora de la tienda). Incremental a cualquier hora.
6. Se mandan TODOS los clientes con nombre, también los que no tienen compras.
7. Facturas (`facturas`, Q10): fuera de esta entrega.

## 4. Datos de SICAR que ya se conocen (F0, sección 14 del plan)

- Cliente de la venta: `COALESCE(ticket.cli_id, nota.cli_id, remision.cli_id)` vía `venta.tic_id/not_id/rem_id`.
  Ventas sin ningún documento: se ignoran.
- `venta.status`: 1 vigente, -1 cancelada. Usar `venta.total` (no recalcularlo de renglones).
- Renglones en `detallev` (`importeCon`, `descTotal`, `precioCon`, `precioNorCon`, ...).
- Cliente: leer SOLO `cli_id, nombre, telefono, celular, mail, rfc, status, clave`. **Prohibido** leer
  `huella`, `muestra`, `foto` (biométricos). **Nunca `SELECT *`.**
- `historial`: `his_id` autoincremental; `tabla='Venta', movimiento=2` = cancelación;
  `tabla='Cliente'` movimientos 0/1/2 = alta/cambio/baja. Cursor por `his_id`.
- Todas las tablas InnoDB. `venta.fecha` **no tiene índice**: nunca filtrar por fecha con OFFSET.
- Texto en latin1: conectar con `charset: 'utf8mb4'` para que MySQL convierta; el servidor rechaza `�`.

**No conoces con certeza todos los nombres de columna** (en especial `detallev`, `historial`, las
fechas y las llaves de `ticket/nota/remision`). No los inventes en silencio: ponlos todos en UN solo
módulo de mapeo, y haz que el agente, al arrancar, compruebe contra `INFORMATION_SCHEMA.COLUMNS` que
cada columna que usa existe; si falta una, se detiene con un mensaje que diga cuál. En tu reporte lista
cada columna que supusiste sin confirmar.

## 5. Invariantes de seguridad (cada uno con su prueba)

1. **Solo lectura, falla cerrando.** Todo SQL pasa por una sola función que acepta únicamente
   sentencias que empiezan con `SELECT` o `SHOW` (tras quitar espacios y comentarios) y rechaza
   `;` intermedio, `INTO OUTFILE`, `INTO DUMPFILE`, `LOAD_FILE`, `FOR UPDATE` y `LOCK`. Cada sesión
   hace `SET SESSION TRANSACTION READ ONLY` y cada página va en `START TRANSACTION READ ONLY` /
   `COMMIT`. `multipleStatements: false`.
2. **Solo localhost.** El host de MySQL en la configuración tiene que ser `127.0.0.1` o `localhost`;
   cualquier otro, el agente no arranca.
3. **Secretos fuera del repo y de los registros.** Llave de la tienda y contraseña de MySQL en un archivo
   de configuración local (ruta por variable de entorno, fuera de la carpeta del repo) y nunca impresas.
   Prueba que el registro no las contiene ni completas ni en parte.
4. Columnas biométricas: prueba que ninguna consulta generada las nombra.
5. **No bloquear la caja:** páginas de 100, una sola conexión, pausa entre páginas, y si una consulta
   pasa de 1 segundo repetidamente, baja la página y avisa (sección 6.8 del plan).

## 6. Comportamiento (el contrato manda; si este despacho y el contrato chocan, detente y reporta)

- **Estado local** en un archivo JSON con escritura atómica (temporal + renombrar): `siguiente_secuencia`,
  cursores (`cli_id` y `ven_id` de la histórica, `his_id`), y el **lote pendiente con sus bytes exactos**.
- **El cursor y la secuencia avanzan solo con 200.** Sin respuesta o red caída, 429 o 503: reenviar
  **los mismos bytes** guardados. 409 `SECUENCIA_INCORRECTA`: rearmar desde `siguiente_secuencia`.
  409 `CONFLICTO_BATCH`, 400, 422, 401: detenerse y registrar el motivo (sin reintentar a ciegas).
- Respetar límites: 100 clientes, 100 ventas, 1,000 renglones (500 por venta), 1 MiB, máximo 12 envíos
  por minuto, un lote a la vez.
- **Formato exacto:** ids como texto, importes con 2 decimales y cantidades/precios con 4, **sin pasar por
  números de punto flotante** (`mysql2` con `decimalNumbers: false` y formateo de texto). `fecha_local`
  sin zona; `captured_at` y `window` con zona.
- **Histórica** (`mode: historico`): primero todos los clientes con nombre por `cli_id` ascendente,
  luego ventas por `ven_id > cursor ORDER BY ven_id LIMIT 100` con tope superior capturado al inicio.
- **Incremental** (`mode: incremental`), cada corrida: ventas nuevas por `ven_id`, `historial` por
  `his_id > cursor` (cancelaciones y cambios de cliente), y relectura completa de las últimas 48 horas
  **por PK** (ids de la ventana guardados en el estado local, no escaneo por fecha).
- Una venta que ya se mandó y ahora es de público en general: mandar `{ ven_id, estado: "excluida" }`.
- **Cómo se ejecuta:** `node agente-sicar/index.js` hace UNA corrida y termina. Lo dispara el
  Programador de tareas de Windows cada 5 minutos. Si ya hay otra corrida activa (archivo de bloqueo),
  sale sin hacer nada. Incluye también un modo `--verificar` que solo se conecta, comprueba columnas,
  hace `SHOW GRANTS` (lo registra como advertencia si hay FILE/GRANT) y cuenta clientes y ventas con
  nombre, **sin mandar nada**.
- `agente-sicar/LEEME.md` para quien lo instala: requisitos, archivo de configuración de ejemplo
  (sin valores reales), cómo crear la tarea programada, cómo correr `--verificar`, y qué hacer con
  cada error. En español claro: lo va a leer alguien que no es programador.

## 7. Archivos

- **Autorizados:** todo dentro de `agente-sicar/` (nuevo); `docs/sicar-contrato-v1.md` (solo sección 6 y,
  si encuentras una contradicción real, avísame antes de cambiar el resto).
- **Prohibidos:** `backend/`, `src/`, `render.yaml`, `package.json` y `package-lock.json` de la raíz,
  cualquier otro archivo. Si para que funcione hace falta tocar el servidor: detente y reporta.

## 8. Pruebas (TDD, `node --test`, sin MySQL real ni red real)

- La conexión a MySQL y `fetch` se inyectan; las pruebas usan dobles. `mysql2` se carga solo en el
  módulo de conexión real, así las pruebas corren aunque no esté instalado.
- Cada prueba nueva debe verse **ROJA antes** de implementar. Si mutas código para comprobarlo,
  revierte la mutación en el mismo turno.
- Mínimo: guardia de SQL (cada palabra prohibida), host no local, secretos fuera del registro,
  biométricos, público excluido, formato de importes (`1500` → `"1500.00"`, `0.1+0.2` no aparece),
  cursor que no avanza sin 200, reenvío de bytes idénticos tras caída, 409 de secuencia, 401 detiene,
  límites de lote, ventana horaria de la histórica, bloqueo de corrida doble, venta que pasa a público
  → `excluida`, cancelación vieja detectada por `historial`.
- Prueba de punta a punta: arma lotes con el agente y pásalos por el servidor real en memoria, reusando el
  patrón de `backend/sicarContrato.test.js` (sin modificarlo), para demostrar que el servidor los acepta.
- Comando (las dos banderas son obligatorias por el sandbox):
  `node --preserve-symlinks --preserve-symlinks-main --test agente-sicar/`
  y la suite del servidor no debe cambiar: `cd backend && node --preserve-symlinks --preserve-symlinks-main --test`
  (línea base en ef6bd08: 2890 pasan, 0 fallan). Si la suite del backend no corre en tu sandbox, dilo.
- Líneas de máximo 200 caracteres. `npx eslint agente-sicar` sin errores.

## 9. Git

- Staging por rutas explícitas, nunca `git add .`. Commits en esta rama: sí, sin acentos en el mensaje.
  Si el sandbox no te deja commitear, deja todo en el árbol de trabajo y dilo.
- Push, merge, rebase: **NO.** `npm install` de mysql2: si no tienes red, deja el `package.json` con la
  versión exacta y dilo; Claude lo instala.

## 10. Detente y reporta (no improvises) si

- El contrato v1 y el servidor no coinciden con lo que necesita el agente.
- Hace falta tocar un archivo prohibido o agregar otra dependencia.
- No puedes decidir una columna o tabla con lo que hay en la sección 4.
- Aparece una regla de negocio que no está escrita aquí.

## 11. Entrega

Reporte con: archivos creados, lista de columnas supuestas sin confirmar, salida de las pruebas (agente y
backend), `git status` y `git log` finales, y cualquier cosa que no pudiste hacer.

---

## 12. Adenda (2026-10-15): renglones repetidos del mismo artículo — PASO 0, antes del agente

Codex se detuvo con razón: el servidor rechaza (`422 ID_DUPLICADO`) una venta con dos renglones del mismo
`art_id` (`backend/sicarIngesta.js:72`, `arreglo(v.detalle, 500, 'art_id')`) y la tabla lo impide
(`PRIMARY KEY (sucursal_id, ven_id, art_id)` en `backend/sicarRepositorio.js:62`). En SICAR una venta puede
traer el mismo artículo en dos renglones (escaneado dos veces, dos precios). **Decisión (Claude, regla obvia de
negocio): se conserva cada renglón tal como está en el ticket.** No se agrupan, no se descartan.

Diseño fijado:
- El renglón se identifica por su **posición en el arreglo `detalle`** (0, 1, 2...). El contrato v1 NO cambia de
  forma: el agente sigue mandando los mismos campos, en el orden del ticket (orden por la PK de `detallev`).
- `sicarIngesta.js`: el detalle deja de exigir `art_id` único por venta. `ven_id` y `cli_id` siguen únicos por lote.
- `sicar_detalles`: nueva columna `renglon INTEGER NOT NULL` y `PRIMARY KEY (sucursal_id, ven_id, renglon)`.
  `escribirVenta` ya borra y reinserta todo el detalle de la venta: inserta `renglon = índice`.
- **Migración al arrancar** (la tabla ya existe en producción, se cree que vacía, no lo asumas): si la tabla no
  tiene `renglon`, reconstruirla en una transacción conservando TODAS las filas, asignando `renglon` por orden
  de `rowid` dentro de cada venta. Prueba con filas precargadas: mismas filas antes y después, idempotente.
- **Respaldo SICAR** (`backend/sicarRespaldo.js`): un respaldo viejo sin `renglon` debe poder restaurarse
  (asignar por orden). Prueba de restauración con respaldo viejo y con nuevo.
- `backend/crmFuentes.js:192`: ordenar renglones por `renglon` (orden del ticket), no por `art_id`.
- `docs/sicar-contrato-v1.md`: decir que un mismo artículo puede repetirse y que el orden del arreglo es el
  orden del ticket. `backend/sicarContrato.test.js`: agregar el caso de dos renglones del mismo artículo
  (aceptado, ambos guardados, total cuadra) y el reenvío idéntico (no duplica).

Archivos autorizados para el paso 0 (además de los de la sección 7): `backend/sicarIngesta.js`,
`backend/sicarRepositorio.js`, `backend/sicarRespaldo.js`, `backend/crmFuentes.js` (solo esa consulta) y sus
`*.test.js`, `backend/sicarContrato.test.js`. Sigue prohibido `backend/server.js` y todo lo demás; si hace falta,
detente.

Orden: paso 0 con TDD (rojo primero) y suite completa del backend en verde (base 2890/0), commit propio
`fix(crm-sicar): renglones repetidos del mismo articulo`; después el agente de las secciones 1 a 11, en commits
aparte.

---

## 13. Adenda 2 (2026-10-15): columna de `historial` desconocida

El paso 0 ya está commiteado (`f612c36`, revisado por Claude, suite 2889 pasan; las 5 fallas de `clavesSat` y
`arranquePersistencia` son de entorno: pasan en la copia principal). **No lo rehagas.**

Codex preguntó con razón qué columna de `historial` identifica la venta o el cliente del movimiento. Nadie lo sabe
sin la base de Ocosingo. Decisión:

- La columna (y, si hace falta, cómo se interpreta su valor) va en la configuración local del agente
  (`historial.columna_referencia`), **sin valor por defecto**. Nada de adivinarla.
- Si no está configurada: el agente funciona igual para la carga histórica, las ventas nuevas y la relectura de
  48 horas (que ya detecta cancelaciones recientes). Solo se apaga la detección por `historial`, con una
  advertencia clara en cada corrida: "cancelaciones antiguas sin vigilar: falta configurar historial". El cursor
  de `his_id` NO avanza mientras esté apagada (para no saltarse movimientos cuando se encienda).
- `--verificar` imprime **en la pantalla local, nunca al servidor**: `SHOW FULL COLUMNS FROM historial` y las
  3 filas más recientes con `tabla='Venta' AND movimiento=2` (y 3 con `tabla='Cliente'`), para que quien instala
  confirme la columna comparando contra una venta cancelada que conozca. Explica en el LEEME cómo hacerlo.
- Si la columna configurada no existe en `INFORMATION_SCHEMA`, el agente no arranca (como el resto del mapeo).
- Pruebas: sin configurar no avanza el cursor y avisa; configurada detecta la cancelación de un ticket viejo y lo
  manda como `cancelada`; columna inexistente detiene.

Sigue con el agente de las secciones 1 a 11 (el paso 0 está hecho).
