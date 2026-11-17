# Despacho: marcar un número SICAR dado de baja como "aclarado" (Entrega A del plan Innotec)

**Rama:** `feature/sicar-numero-aclarado` — **worktree:**
`C:\Users\Victor\Desktop\CORPUNISOUND\.claude\worktrees\seguimiento-mejoras` — **commit base:** `0cc1274` (master).
Un solo responsable de escritura: tú. Lee primero `CLAUDE.md` de la raíz.

**Pruebas (obligatorio con estas banderas):**
`cd backend && node --preserve-symlinks --preserve-symlinks-main --test sicarTraspasos.test.js sicarRutas.test.js
sicarRepositorio.test.js sicarRespaldo.test.js seguimientoFactura/consultas.test.js seguimientoFactura/rutas.test.js
seguimientoFactura/respaldo.test.js ../src/seguimiento/seguimiento.test.js`
(si `sicarRutas.test.js` no existe con ese nombre, usa el archivo donde ya se prueban las rutas `/api/sicar/...`).
Si alguna falla con EPERM al crear temporales en tu sandbox, escribe la prueba igual y reporta cuál no pudiste correr.
NO corras la suite completa. Al final `npx eslint src backend --quiet`: 0 errores.
No puedes hacer `git add`/`commit`: deja los cambios en el árbol.

## Contexto de negocio

Los números SICAR 3 y 7 están dados de baja (eran números viejos de Palenque). El bloque gris del Seguimiento de
Facturas lista sus envíos que nadie marcó como recibidos (4 envíos, ≈ $48,815). El dueño ya confirmó que **esa
mercancía se ajustó después**: no hay nada que aclarar. Hoy no hay forma de decirlo y el bloque los seguirá mostrando
para siempre. Se necesita poder marcar un número dado de baja como **aclarado**, con una nota, dejando quién y cuándo.

## Qué construir (TDD: cada prueba se ve ROJA antes de implementar)

1. **Guardar el aclarado** en `sicar_sucursales_mapa`, tres columnas nuevas: `aclarado_en TEXT`, `aclarado_nota TEXT`,
   `aclarado_por TEXT`. En `sicarRepositorio.js`: en el `CREATE TABLE` y con migración `pragma table_info` +
   `ALTER TABLE ... ADD COLUMN` (mismo bucle donde ya están `baja` y `nombre`). **Respaldo** (`sicarRespaldo.js`, mismo
   bloque que rellena `baja`/`nombre`): una copia vieja sin esas claves restaura con `NULL`. Sin cambiar la lista de
   tablas ni la generación del respaldo.
2. **Función nueva** `aclararBajaSicar(sqlite, datos, actor, alcance)` en `backend/sicarTraspasos.js` (exportada):
   - Mismo control que `asignarMapaSicar`: solo con alcance total (si no, 403 con el mismo mensaje del mapa); actor
     obligatorio (401).
   - `datos.sicar_sucursal`: misma validación que `asignarMapaSicar`. El número debe existir en el mapa **y estar de
     baja** (`baja = 1`); si no, 400 "Solo se puede marcar como aclarado un número dado de baja."
   - `datos.aclarado`: booleano estricto (otro tipo → 400).
   - Con `aclarado: true`: `datos.nota` texto obligatorio, recortado, de 3 a 200 caracteres (fuera de rango → 400).
     Guarda `aclarado_en = ahora` (ISO), `aclarado_nota`, `aclarado_por = actor`.
   - Con `aclarado: false`: pone las tres columnas en `NULL` (no pide nota).
   - Siempre escribe una fila en `sicar_sucursales_mapa_historial` (actor y fecha): al marcar `anterior='baja'`,
     `nuevo='aclarado'`; al desmarcar `anterior='aclarado'`, `nuevo='baja'`. Si no cambia nada (ya estaba igual, misma
     nota), no escribe historial. Todo dentro de una transacción `.immediate()`.
   - **No** marca claves pendientes de recálculo: esto no cambia ningún cálculo.
3. **`asignarMapaSicar`** (misma función de hoy): cuando un número deja de estar de baja (se le asigna tienda o se
   deja "Sin tienda"), las tres columnas de aclarado se ponen en `NULL` en ese mismo movimiento. Marcar baja de nuevo
   empieza sin aclarado.
4. **Ruta nueva** en `backend/sicarRutas.js`: `PUT /api/sicar/sucursales-mapa/aclarado`, permiso
   `administrar_sucursales` (el mismo que ya protege cambiar el mapa), registrada junto a las del mapa. Llama a
   `aclararBajaSicar` con `String(req.usuarioToken.id)` como actor y el alcance, igual que la ruta del mapa.
5. **`listarMapaSicar`** devuelve además `aclarado_en`, `aclarado_nota`, `aclarado_por`.
6. **Consulta del bloque gris** (`sicarSinAsignar` en `backend/seguimientoFactura/consultas.js`): cada elemento de
   `bajas` agrega `aclarado_en`, `aclarado_nota`, `aclarado_por` y `envios_aclarados` (cuántos envíos quedaron
   cubiertos). Regla: un envío queda cubierto si su `fecha` (día) es **menor o igual** al día local de `aclarado_en`
   (`fechaLocal` de `backend/fechas.js`). Los cubiertos **no** van en `envios` ni suman en `total_centavos`. Un envío
   con fecha posterior al aclarado **sí** aparece (alguien volvió a mandar mercancía a un número muerto: eso es noticia).
7. **Pantalla** (`src/seguimiento/SeguimientoFacturas.jsx`; textos en `seguimiento.js` con prueba):
   - En el bloque gris, el renglón de un número aclarado dice:
     "SICAR 3 (Palenque (número anterior)) · aclarado el 16/11/2026 · Nota: la mercancía se ajustó" y, si quedan
     envíos posteriores sin recibir, además "· N envíos sin recibir · $X según SICAR" con su tabla como hoy.
     Si **todos** los números de baja están aclarados y sin envíos posteriores, el encabezado del bloque dice
     "Sucursales SICAR dadas de baja: sin pendientes" (sigue plegado y gris).
   - Con el permiso `administrar_sucursales` (el componente ya recibe `permisos`): por número **no aclarado**, un campo
     de texto "Nota (qué pasó con esa mercancía)" y botón "Marcar como aclarado" (deshabilitado hasta 3 caracteres);
     por número **aclarado**, botón "Quitar aclarado". Sin `prompt`/`confirm` del navegador. Al terminar recarga el
     bloque; si el servidor rechaza, muestra el mensaje. Sin el permiso no se pintan campo ni botones.
   - `type="button"` explícito en los botones; ninguna línea de más de 200 caracteres.
   - El nombre de quien aclaró: la consulta devuelve el id (`aclarado_por`); muéstralo solo si ya hay en la pantalla
     una forma de traducir id → nombre; si no, no lo muestres (queda en el historial) y dilo en el reporte.

## Archivos autorizados

`backend/sicarTraspasos.js`, `backend/sicarRutas.js` (solo la ruta nueva), `backend/sicarRepositorio.js` (solo las
columnas y su migración), `backend/sicarRespaldo.js` (solo el relleno al restaurar),
`backend/seguimientoFactura/consultas.js` (solo `sicarSinAsignar`), sus `.test.js` (y `seguimientoFactura/rutas.test.js`,
`seguimientoFactura/respaldo.test.js`, `sicarRespaldo.test.js`, `sicarRepositorio.test.js` si hace falta);
`src/seguimiento/SeguimientoFacturas.jsx`, `src/seguimiento/seguimiento.js`, `src/seguimiento/seguimiento.test.js`.
**Prohibido** todo lo demás: `server.js`, `permisosCatalogo.js` (no hay permisos nuevos), `motor.js`, `lector.js`,
`servicio.js`, `src/sicar/TraspasosSicar.jsx`, `render.yaml`.

## Aviso sobre pruebas existentes (ya nos mordió dos veces)

Hay pruebas que insertan en `sicar_sucursales_mapa` sin nombrar columnas o que comparan su lista exacta de columnas
(`sicarRepositorio.test.js` ~510: `['sicar_sucursal', 'sucursal_id', 'asignado_por', 'asignado_en', 'baja', 'nombre']`)
y comparaciones de objeto completo de filas del mapa o de `bajas`. **Está autorizado** corregirlas agregando las claves
nuevas. Búscalas en todo `backend/` y `src/` antes de entregar y lístalas.

## Reglas

- Sin dependencias nuevas. Acentos en UTF-8 real (sin `Ã³` ni `�`). Dinero en BigInt/texto.
- Validación en el servidor y fallando cerrando.
- Si mutas código para ver una prueba roja, revierte en el mismo paso.

## Pruebas mínimas

- Marcar aclarado un número de baja: columnas llenas, historial `baja → aclarado` con actor; repetir igual no agrega
  historial. Sin nota, nota de 2 caracteres, nota de 201, `aclarado: "true"` → 400. Número que no está de baja → 400.
  Usuario sin alcance total → 403.
- Quitar aclarado: columnas en `NULL`, historial `aclarado → baja`.
- Asignar tienda a un número aclarado: deja de estar de baja y sin aclarado.
- Bloque: envío anterior o del mismo día del aclarado no aparece ni suma, `envios_aclarados` lo cuenta; envío posterior
  sí aparece y suma.
- Ruta: sin sesión 401; sin `administrar_sucursales` 403 (rol con permisos vecinos, nunca `permisos: []`); correcta 200.
- Respaldo viejo sin las columnas restaura con `NULL`.
- Textos del renglón aclarado y del encabezado "sin pendientes" en `seguimiento.test.js`.

## Detente y reporta (no improvises) si

- Hace falta tocar un archivo prohibido o cambiar la lista/generación de tablas del respaldo.
- Una prueba existente cambia de expectativa por algo distinto a agregar las claves nuevas.

## Entrega

Conteo de pruebas por archivo, evidencia rojo→verde, eslint, `git status --short`, pruebas que no pudiste correr,
pruebas existentes que ajustaste, decisiones no cubiertas y qué hay que probar en el navegador. Confirma que no dejas
procesos corriendo.
