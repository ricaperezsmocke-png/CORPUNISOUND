# Mi Objetivo de Venta — Entrega 2a: Actividades y estrategias — Plan de implementación

> **Para quien implementa:** trabaja tarea por tarea, en orden, con TDD. Cada tarea termina con sus
> pruebas en verde y se detiene para que Claude la revise y la commitee. Los pasos usan casillas
> (`- [ ]`).

**Objetivo:** que el gerente fije metas de actividad por tienda (publicar en grupos, publicar en
marketplace, salidas a iglesias, jornadas de volanteo), las reparta entre su plantilla, y que cada
persona registre cada actividad con su evidencia (link o foto en Drive), marcada siempre como
**"declarada, no verificada"**, y que el cierre de mes la selle junto con la venta.

**Arquitectura:** las metas de actividad reutilizan la tabla `DB.pos.objetivos` con `tipo:
"actividad"` y un campo nuevo `actividad` (la clase). Los registros viven en una colección nueva
`DB.pos.objetivo_actividades`, en un módulo nuevo `backend/objetivosActividades.js` que recibe el
cliente de Drive inyectado (igual que `backend/depositos.js`). El cierre (`backend/objetivosCierre.js`)
agrega las actividades a su fotografía y a sus líneas.

**Tecnología:** Node + Express (backend en memoria persistido a SQLite como un JSON), React + Vite +
Tailwind, pruebas con `node:test`. **Ninguna dependencia nueva.**

**Spec:** `docs/superpowers/specs/2026-09-13-mi-objetivo-de-venta-design.md` (en el repo principal,
sin trackear; ruta absoluta
`C:/Users/Victor/Desktop/CORPUNISOUND/docs/superpowers/specs/2026-09-13-mi-objetivo-de-venta-design.md`).
Lee las secciones "Decisiones de Victor", "Lo verificable y lo declarado no valen igual", "La
evidencia" y "Riesgos conocidos". Este plan manda donde los dos difieran.

## Restricciones globales

- **Ninguna dependencia nueva.** No toques `package.json` ni `package-lock.json` (ni los de `backend/`).
- **Los archivos van a Google Drive, nunca al disco del servidor.** Nada de `fs.writeFile` de fotos,
  nada de carpetas `uploads/`. Se sube con `drive.subirArchivoADrive` y se guarda solo el id y el link.
- **Sin video.** Solo foto (JPG o PNG, máximo 10 MB) y link (`http://` o `https://`).
- **Nada se borra.** Un registro equivocado se **anula con motivo**; queda visible y tachado.
- **Acentos en código e interfaz sí van, en UTF-8 correcto.** Revisa que no escribas mojibake
  (`Ã¡`, `Ã³`, `Â·`). Ninguna línea nueva de más de 200 caracteres.
- **El mes cerrado no se toca:** toda escritura nueva pasa por `validarMesObjetivosAbierto`.
- **La identidad sale del token y del registro original, nunca del cuerpo de la petición.**
  Solo la propia persona registra, anula o agrega resultado a SUS actividades (igual que la captura
  de venta: `vendedorLigadoAObjetivos(req) === vendedor_id`).
- **Alcance por sucursal:** igual que las rutas de objetivos existentes (`sucursalObjetivosPermitida`
  y `alcancePropioPorPlantilla`). Fuera de alcance responde **404**, nunca 403.
- **El selector de tienda del encabezado NO es un permiso.** Nunca leas `?sucursal_id=` para decidir
  qué puede ver alguien.

## Decisiones ya tomadas (no las vuelvas a decidir; si algo las contradice, detente y reporta)

1. **Cuatro clases fijas de actividad**, en un catálogo de código, no texto libre:

   | clave | etiqueta | evidencia | unidad |
   |---|---|---|---|
   | `grupos` | Publicación en grupos | link | publicación |
   | `marketplace` | Publicación en Marketplace | link | publicación |
   | `iglesia` | Salida a iglesia | foto | salida |
   | `volanteo` | Jornada de volanteo | foto | jornada |

2. **Cada registro vale UNA unidad.** No se teclea cantidad ("nada de 500 volantes tecleados"). Veinte
   grupos son veinte registros con veinte links.
3. **La meta de actividad es de tienda y se reparte** entre la plantilla, igual que la de venta:
   partes iguales sugeridas, el gerente ajusta, y lo que no cuadra aparece como **sin asignar**.
   Las metas de actividad son números enteros de unidades (≥ 0).
4. **Evidencia repetida:**
   - La **misma persona** no puede presentar la misma evidencia dos veces: **se rechaza**.
   - **Otra persona** de la misma tienda puede presentarla solo si confirma que fue una **actividad
     conjunta** (`conjunta: true` en la petición). Sin esa confirmación se rechaza con un mensaje que
     dice quién la presentó y qué día. Con ella se guarda `conjunta_con: <id del registro original>`.
   - **Para la tienda, una actividad conjunta cuenta una sola vez.** Para cada persona cuenta, marcada
     como "conjunta".
   - "Misma evidencia" = mismo link normalizado, o misma foto por su huella SHA-256 del contenido.
   - La repetición se busca en **toda la empresa y en cualquier mes**, entre registros **vigentes**.
     Si la evidencia repetida es de **otra tienda**, se rechaza siempre (no hay conjunta entre tiendas).
5. **Anular:** la propia persona, con motivo obligatorio, mientras el mes esté abierto. El registro
   queda con `vigente: false`, `anulado_por`, `anulado_en`, `motivo_anulacion`. **La foto se queda en
   Drive** (es evidencia; igual que los depósitos cancelados).
6. **Resultado posterior:** la propia persona puede agregar a un registro vigente `contactos` y
   `cotizaciones` (enteros ≥ 0) con una nota opcional, mientras el mes esté abierto. Se **apilan** en
   `resultados: []` con quién y cuándo; lo vigente es el último. Nunca se sobrescribe uno anterior.
7. **Fechas:** dentro del mes, nunca futura (hora de Chiapas: `fechaLocal` de `backend/fechas.js`),
   y ese día la persona debe estar en la plantilla de esa tienda (misma regla que
   `validarDatosCaptura` en `backend/objetivosCaptura.js`). Registrar atrasado se permite y la
   pantalla muestra "registrado N días después".
8. **Drive caído = la operación falla completa.** Sin foto no hay registro de clase con foto. No se
   guarda nada a medias.
9. **"Declarada, no verificada"** aparece junto a toda cifra de actividad en las tres pantallas.
   **Las actividades no entran en `real_sicar` ni en la diferencia del cierre** (SICAR solo cubre
   ventas) y **no son rectificables**: `CAMPOS_RECTIFICABLES` no cambia.
10. **Quien solo tiene actividades en el mes (sin venta) también aparece en el cierre**, y como hoy,
    el cierre exige su `real_sicar` (puede ser 0).

## Coordenadas (las llena Claude; verifícalas antes de empezar)

- **Worktree, único lugar donde escribes:** `C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/objetivos-actividades`
- **Rama:** `feature/objetivos-actividades` · **Commit base:** el commit de este plan, sobre `9e2711d`.
- **Comando de pruebas, SIEMPRE por archivo** (la suite completa se arrastra en tu entorno y la corre
  Claude):
  `node --preserve-symlinks --preserve-symlinks-main --test backend/<archivo>.test.js`
  y para `src/`: `node --preserve-symlinks --preserve-symlinks-main --test src/objetivos/<archivo>.test.js`
- **No commitees** (tu sandbox no puede). Al terminar cada tarea, deja los cambios sin commitear y
  reporta. Claude revisa, corre la suite y commitea por rutas.
- **Nunca `git add .`**, nunca `git stash`, nunca push, merge ni rebase.

### Archivos autorizados

- Crear: `backend/objetivosActividadesCatalogo.js`, `backend/objetivosActividades.js`,
  `backend/objetivosActividades.test.js`, `backend/objetivosActividadesRutas.test.js`,
  `src/objetivos/ActividadesVendedor.jsx`, `src/objetivos/ActividadesGerente.jsx`,
  `src/objetivos/actividades.js`, `src/objetivos/actividades.test.js`.
- Modificar: `backend/objetivos.js`, `backend/objetivos.test.js`, `backend/objetivosCierre.js`,
  `backend/objetivosCierre.test.js`, `backend/drive.js` (solo agregar dos funciones y exportarlas),
  `backend/server.js` (solo: la colección por defecto, el `require`, y las rutas de objetivos),
  `backend/objetivosRutas.test.js`, `src/GerenciaVentas.jsx`, `src/CierreObjetivos.jsx`,
  `src/objetivos/RepartoGerente.jsx` (solo si hace falta para montar la sección nueva).

### Archivos prohibidos

Todo lo demás. En particular: `backend/auth.js`, `backend/roles.js`, `backend/permisosCatalogo.js`
(**no hace falta ningún permiso nuevo**), `backend/persistencia.js`, `backend/ventas.js`,
`backend/depositos.js`, `render.yaml`, cualquier `package.json`.

### Detente y reporta (no improvises) si

- Necesitas tocar un archivo no autorizado o agregar una dependencia.
- Una decisión de negocio no está escrita aquí.
- Una prueba existente se rompe y no es por un cambio que este plan pide.
- El código real no coincide con lo que este plan describe (nombres, rutas, estructura).

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `backend/objetivosActividadesCatalogo.js` | Las 4 clases y funciones de consulta del catálogo. Sin lógica de negocio. |
| `backend/objetivos.js` | Metas: aceptar `tipo: "actividad"` + `actividad`; reparto y estado por tipo/clase. |
| `backend/objetivosActividades.js` | Registrar (con evidencia y repetición), anular, agregar resultado, resúmenes. |
| `backend/drive.js` | Carpeta "Evidencias de Actividades" / sucursal. |
| `backend/objetivosCierre.js` | El cierre incluye actividades en `previoCierre`, `lineas` y `foto`. |
| `backend/server.js` | Colección por defecto y rutas HTTP. |
| `src/objetivos/actividades.js` | Funciones puras de pantalla (normalizar link, contar, leer archivo a base64). |
| `src/objetivos/ActividadesVendedor.jsx` | Lo que ve y registra la persona. |
| `src/objetivos/ActividadesGerente.jsx` | Metas de actividad, reparto y lista de la tienda con evidencia. |

---

### Task 1: Catálogo y metas de actividad

**Archivos:**
- Crear: `backend/objetivosActividadesCatalogo.js`
- Modificar: `backend/objetivos.js`
- Pruebas: `backend/objetivos.test.js`

**Interfaces que produce:**
```js
// objetivosActividadesCatalogo.js
const CLASES_ACTIVIDAD = [
  { clave: "grupos",      etiqueta: "Publicación en grupos",      evidencia: "link", unidad: "publicación" },
  { clave: "marketplace", etiqueta: "Publicación en Marketplace", evidencia: "link", unidad: "publicación" },
  { clave: "iglesia",     etiqueta: "Salida a iglesia",           evidencia: "foto", unidad: "salida" },
  { clave: "volanteo",    etiqueta: "Jornada de volanteo",        evidencia: "foto", unidad: "jornada" },
];
function claseActividad(clave) // -> objeto del catálogo o null
module.exports = { CLASES_ACTIVIDAD, claseActividad };

// objetivos.js (firmas nuevas o ampliadas)
fijarObjetivo(DB, { tipo, actividad, mes, sucursal_id, vendedor_id, monto, motivo }, usuario)
objetivoVigente(DB, { tipo, actividad, mes, sucursal_id, vendedor_id })
historialObjetivo(DB, { tipo, actividad, mes, sucursal_id, vendedor_id })
repartoSugerido(DB, { mes, sucursal_id, tipo = "venta", actividad = null })
estadoDelReparto(DB, { mes, sucursal_id, tipo = "venta", actividad = null })
```

**Reglas:**
- `tipo` válido: `"venta"` o `"actividad"`. Con `"venta"`, `actividad` debe ser `null`/ausente.
  Con `"actividad"`, `actividad` debe existir en el catálogo y `monto` debe ser **entero** ≥ 0.
- `mismaCombinacion` compara también `(o.actividad ?? null) === (datos.actividad ?? null)`. Las metas
  de venta ya guardadas no tienen ese campo: **deben seguir encontrándose igual** (prueba explícita).
- El objeto guardado lleva `actividad` (`null` en venta).
- `repartoSugerido` con actividad reparte en enteros: partes iguales con `Math.floor` y el residuo
  al último, igual que hoy (conserva el total).

- [ ] **Paso 1: pruebas que fallan** en `backend/objetivos.test.js`:
  - fijar meta de tienda `{ tipo: "actividad", actividad: "iglesia", vendedor_id: null, monto: 3 }` se
    guarda con `actividad: "iglesia"`, versión 1.
  - una meta de `iglesia` y otra de `grupos` del mismo mes/tienda/persona **no se reemplazan entre sí**;
    tampoco reemplazan la de venta.
  - `tipo: "actividad"` sin `actividad`, con clase inexistente (`"tiktok"`) o con `monto: 2.5` → error.
  - `tipo: "venta"` con `actividad: "iglesia"` → error. `tipo: "otro"` → error.
  - una meta de venta guardada SIN el campo `actividad` (empújala a mano a `DB.pos.objetivos`) sigue
    siendo la vigente para `objetivoVigente(DB, { tipo: "venta", ... })`.
  - `repartoSugerido` de `volanteo` con meta 10 y 3 personas en plantilla → `[3, 3, 4]`, suma 10.
  - `estadoDelReparto` de `grupos` con meta 20 y partes 8 + 8 → `sin_asignar: 4`.
  - las llamadas SIN `tipo` a `repartoSugerido`/`estadoDelReparto` siguen dando lo de venta.
- [ ] **Paso 2:** córrelas y confirma que fallan por la razón correcta.
- [ ] **Paso 3:** implementa lo mínimo.
- [ ] **Paso 4:** `node --preserve-symlinks --preserve-symlinks-main --test backend/objetivos.test.js`
  todo en verde, incluidas las pruebas viejas.
- [ ] **Paso 5:** detente y reporta (Claude commitea `feat(objetivos): metas de actividad por tienda`).

---

### Task 2: Registro de actividades (dominio)

**Archivos:**
- Crear: `backend/objetivosActividades.js`, `backend/objetivosActividades.test.js`
- Modificar: `backend/drive.js`

**Interfaces que produce:**
```js
// drive.js — mismo patrón que asegurarCarpetaDepositosRaiz/Sucursal
async function asegurarCarpetaActividadesRaiz(DB)            // "Evidencias de Actividades", guarda DB.drive.carpeta_actividades_id
async function asegurarCarpetaActividadesSucursal(DB, sucursal) // guarda sucursal.drive_folder_actividades_id

// objetivosActividades.js
function normalizarLink(link)            // -> string normalizado o lanza Error
async function registrarActividad(DB, datos, usuario, drive)
//   datos = { mes, fecha, sucursal_id, vendedor_id, actividad, link?, archivo?, nota?, conjunta? }
//   archivo = { nombre_archivo, tipo_mime, contenido_base64 }
function anularActividad(DB, id, motivo, usuario)
function agregarResultado(DB, id, { contactos, cotizaciones, nota }, usuario)
function actividadesDelMes(DB, { mes, sucursal_id, vendedor_id? })   // vigentes y anuladas, orden por fecha
function resumenActividades(DB, { mes, sucursal_id, vendedor_id? })
//   -> [{ actividad, etiqueta, declaradas, conjuntas }]  (solo vigentes)
//   Sin vendedor_id: resumen de TIENDA, donde una conjunta cuenta una vez.
```

**Forma del registro guardado en `DB.pos.objetivo_actividades`:**
```js
{
  id, mes, fecha, sucursal_id, vendedor_id, actividad,
  evidencia: { tipo: "link", link: "<normalizado>" }
           | { tipo: "foto", nombre_archivo, drive_file_id, drive_link, huella: "<sha256 hex>" },
  nota: string|null,
  conjunta_con: id|null,
  registrado_por, registrado_en,   // ISO
  vigente: true,
  anulado_por: null, anulado_en: null, motivo_anulacion: null,
  resultados: [],                  // [{ contactos, cotizaciones, nota, registrado_por, registrado_en }]
}
```

**Reglas (cada una con su prueba):**
- Validaciones de fecha, mes y plantilla: iguales que `validarDatosCaptura` de
  `backend/objetivosCaptura.js`. **Extrae la parte de fecha + plantilla a una función reutilizable
  solo si puedes dejar `capturarDia` exactamente igual**; si no, repítela y repórtalo.
- La clase define la evidencia: si es `link`, exige `link` y rechaza `archivo`; si es `foto`, exige
  `archivo` y rechaza `link`.
- `normalizarLink`: recorta espacios; solo `http:` o `https:` (usa `new URL`); host en minúsculas;
  quita el `#fragmento`; quita la `/` final del path; conserva la query. `javascript:`, `ftp:`, texto
  sin esquema → error "El link debe empezar con http:// o https://". Máximo 500 caracteres.
- Foto: `tipo_mime` solo `image/jpeg` o `image/png`; máximo 10 MB; `huella` =
  `crypto.createHash("sha256").update(buffer).digest("hex")` (módulo nativo de Node, no es dependencia).
- `nota`: opcional, recortada, máximo 300 caracteres.
- **Repetición** (decisión 4 del encabezado): busca por link normalizado o por huella entre registros
  vigentes de cualquier mes. Mismo `vendedor_id` → error "Ya presentaste esta evidencia el <fecha>".
  Otra tienda → error. Misma tienda y `conjunta !== true` → error
  "Esta evidencia ya la presentó <nombre> el <fecha>. Si fue una actividad conjunta, confírmalo."
  Con `conjunta === true` → se guarda con `conjunta_con` = id del registro ORIGINAL (el que no tiene
  `conjunta_con`).
- **Orden para no dejar nada a medias:** todas las validaciones síncronas (incluida la repetición)
  ANTES del primer `await`. Luego marca de "subida en curso" por huella (un `Set` a nivel de módulo,
  como `adjuntosEnCurso` de `depositos.js`) para que dos clics seguidos no suban dos veces. Sube a
  Drive. **Después del `await`, revalida la repetición** (otro registro pudo entrar mientras tanto).
  Solo entonces empuja el registro. Si Drive falla o no devuelve `id` y `webViewLink`, lanza error y
  **no se guarda nada**. El archivo huérfano en Drive es el lado seguro del error.
- Nombre en Drive: `<fecha> - <nombre vendedor> - <clave actividad> - <nombre_archivo>`.
- Links no llaman a Drive.
- `anularActividad`: registro inexistente o ya anulado → error; motivo vacío → error.
- `agregarResultado`: solo sobre registros vigentes; `contactos` y `cotizaciones` enteros ≥ 0
  (ambos obligatorios); apila, nunca reemplaza.
- `resumenActividades` de tienda: cuenta vigentes, pero un registro con `conjunta_con` cuya original
  siga vigente **no suma** a la tienda. Si la original se anuló, la conjunta más antigua pasa a contar
  (la tienda no pierde una salida real porque alguien anuló la suya). Prueba ese caso.

- [ ] **Paso 1: pruebas que fallan.** Usa un `drive` falso en la prueba (objeto con
  `asegurarCarpetaActividadesSucursal` y `subirArchivoADrive` que registran llamadas). Cubre como
  mínimo: link válido; link `javascript:` rechazado; foto válida sube y guarda huella; foto PDF
  rechazada; foto de 11 MB rechazada; clase con link recibiendo archivo rechazada; fecha futura
  rechazada; persona fuera de plantilla ese día rechazada; misma persona repite link rechazada (con
  `https://Facebook.com/x/` vs `https://facebook.com/x` como el mismo); otra persona sin `conjunta`
  rechazada con el nombre en el mensaje; con `conjunta` aceptada y `conjunta_con` correcto; otra tienda
  rechazada aunque diga `conjunta`; Drive que lanza → nada guardado y `DB.pos.objetivo_actividades`
  igual que antes; Drive que devuelve `{}` → nada guardado; dos `registrarActividad` simultáneos con
  la misma foto (sin esperar el primero) → solo uno queda guardado; anular con y sin motivo;
  resultado apilado dos veces conserva los dos; resumen de tienda con conjunta cuenta 1 y resumen de
  cada persona cuenta 1 cada una; anular la original hace contar a la conjunta.
- [ ] **Paso 2:** confirma que fallan por la razón correcta.
- [ ] **Paso 3:** implementa.
- [ ] **Paso 4:** `node --preserve-symlinks --preserve-symlinks-main --test backend/objetivosActividades.test.js`
  y `backend/objetivosCaptura.test.js` en verde. Si tocaste `drive.js`, también `backend/drive.test.js`.
- [ ] **Paso 5:** detente y reporta (Claude commitea `feat(objetivos): registro de actividades con evidencia`).

---

### Task 3: Rutas HTTP

**Archivos:**
- Modificar: `backend/server.js`
- Crear: `backend/objetivosActividadesRutas.test.js` (copia el arranque de servidor real que usa
  `backend/objetivosRutas.test.js`; no inventes otro)

**Cambios en `server.js`:**
- Colección por defecto `objetivo_actividades: []` junto a `objetivo_plantilla` (así una base
  guardada que no la trae arranca con `[]`: el bucle de restauración solo copia las tablas que existen
  en el estado guardado). **Prueba que una base sin esa tabla arranca y lista vacío.**
- `GET /api/objetivos/:mes/:sucursalId` agrega a su respuesta
  `actividades: [{ actividad, etiqueta, meta_tienda, asignado, sin_asignar, lineas }]` (una por clase,
  usando `estadoDelReparto` con tipo actividad). **Para quien no es jefatura con alcance normal, igual
  que hoy con la venta: solo sus propias líneas, sin `meta_tienda`, `asignado` ni `sin_asignar`.**
- `POST /api/objetivos` ya fija metas: debe aceptar `tipo: "actividad"` + `actividad`. El motivo
  obligatorio al cambiar una meta existente aplica igual.
- `GET /api/objetivos/:mes/:sucursalId/historial/:vendedorId` acepta `?tipo=actividad&actividad=<clave>`
  (sin query sigue siendo venta). Clave inválida → 400.
- `GET /api/objetivos/:mes/:sucursalId/sugerencia` acepta los mismos query params.
- Nuevas:
  - `GET /api/objetivos/catalogo-actividades` → `CLASES_ACTIVIDAD`. Permiso `usar_gerente_ventas`.
    **Declárala ANTES de `GET /api/objetivos/:mes/:sucursalId`**, o Express la leerá como `:mes`.
  - `GET /api/objetivos/:mes/:sucursalId/actividades/:vendedorId` → `{ registros, resumen }` de esa
    persona. Mismo control de acceso que `.../capturas/:vendedorId` (propia persona o jefatura con
    alcance o jefatura histórica por plantilla).
  - `GET /api/objetivos/:mes/:sucursalId/actividades` → `{ registros, resumen_tienda, resumen_por_persona }`.
    Solo jefatura (`editar_objetivos_venta`) con alcance normal, o `cerrar_mes_objetivos` con alcance.
    Los demás: 404.
  - `POST /api/objetivos/actividad` (async, pasa el módulo `drive` como hace `/api/depositos`).
    Solo la propia persona. Mes abierto.
  - `POST /api/objetivos/actividad/:id/anular` y `POST /api/objetivos/actividad/:id/resultado`.
    La identidad y la tienda salen del registro ORIGINAL. Solo la propia persona. Mes abierto.
- **Ninguna respuesta incluye `drive_file_id`** (igual que `/api/respaldos`): solo `drive_link`.
- Errores de validación → 400 con `{ error }`. Fuera de alcance → 404.

- [ ] **Paso 1: pruebas que fallan** (servidor real): vendedor registra link y lo ve; vendedor NO ve
  las de su compañero (404); vendedor no registra a nombre de otro (404); gerente de otra tienda no
  ve la lista de esta (404); `?sucursal_id=` en la query no cambia nada; mes cerrado → 400 en
  registrar, anular y resultado; `drive_file_id` no aparece en ninguna respuesta; `GET
  /api/objetivos/catalogo-actividades` no cae en `/:mes/:sucursalId`; el vendedor no recibe
  `meta_tienda` de actividades; meta de actividad se fija por `POST /api/objetivos` y aparece en el
  GET; una base sin `objetivo_actividades` arranca.
  Para la foto en rutas, sustituye las funciones del módulo de Drive **como ya lo hace
  `backend/gastoCajaFuertePermiso.test.js:56-65`**: guardar las originales, reemplazar
  `drive.asegurarCarpetaActividadesSucursal` y `drive.subirArchivoADrive` en el objeto que exporta
  `require("./drive")`, y restaurarlas al final. No inventes otro mecanismo.
- [ ] **Paso 2:** confirma que fallan.
- [ ] **Paso 3:** implementa.
- [ ] **Paso 4:** en verde: `backend/objetivosActividadesRutas.test.js`, `backend/objetivosRutas.test.js`.
- [ ] **Paso 5:** detente y reporta (Claude commitea `feat(objetivos): rutas de actividades`).

---

### Task 4: El cierre sella las actividades

**Archivos:**
- Modificar: `backend/objetivosCierre.js`, `backend/objetivosCierre.test.js`

**Cambios:**
- `previoCierre`: agrega como participante a quien tenga una meta de actividad vigente o un registro de
  actividad vigente ese mes/tienda. Cada línea gana
  `actividades: [{ actividad, meta, declaradas, conjuntas }]` (todas las clases del catálogo, en orden).
- `cerrarMes`: `lineas[i].actividades` igual que en el previo; `foto.actividades` = copia profunda de
  TODOS los registros de actividad del mes/tienda (vigentes y anulados, con sus resultados);
  `resumen_actividades_tienda` = `resumenActividades` de tienda. `foto.objetivos` ya incluye las metas
  vigentes de cualquier tipo: **compruébalo con una prueba**, no lo asumas.
- `diferencia` y `real_sicar` no cambian: siguen siendo solo de venta.
- `rectificarCierre` no cambia.

- [ ] **Paso 1: pruebas que fallan:** persona con solo actividades aparece en el previo y el cierre
  le exige real de SICAR; la foto conserva un registro aunque DESPUÉS del cierre se mute el original
  en `DB` (anúlalo a mano y verifica que la foto no cambió); la foto incluye las metas de actividad;
  el resumen de tienda del cierre cuenta una conjunta una vez; `diferencia` no cambia por tener
  actividades.
- [ ] **Paso 2 – 4:** rojo, implementa, verde (`backend/objetivosCierre.test.js` y
  `backend/objetivosRutas.test.js`).
- [ ] **Paso 5:** detente y reporta (Claude commitea `feat(objetivos): el cierre sella las actividades`).

---

### Task 5: Pantalla de la persona

**Archivos:**
- Crear: `src/objetivos/actividades.js`, `src/objetivos/actividades.test.js`,
  `src/objetivos/ActividadesVendedor.jsx`
- Modificar: `src/GerenciaVentas.jsx` (montar la sección debajo de `CapturaVendedor`, con los mismos
  datos de mes, sucursal y vendedor que ya usa)

**`actividades.js` (puras, con prueba):**
- `leerArchivoComoBase64(file)` → `Promise<{ nombre_archivo, tipo_mime, contenido_base64 }>` (sin el
  prefijo `data:...;base64,`). Rechaza antes de enviar lo que no sea JPG/PNG o pese más de 10 MB,
  con el mismo mensaje que el servidor.
- `avanceActividad({ meta, declaradas })` → `{ porcentaje, faltan }` (meta 0 → porcentaje 0, sin
  dividir entre cero).

**Lo que muestra `ActividadesVendedor`:**
- Título "Mis actividades" y, visible siempre junto a los números, la leyenda
  **"Declaradas, no verificadas"**.
- Por cada clase con meta o con registros: etiqueta, meta, declaradas, faltan.
- Formulario (oculto si el mes está cerrado): clase (select del catálogo), fecha (mín. día 1 del mes,
  máx. hoy), y según la clase **un campo de link** o **un selector de foto** (`accept="image/jpeg,image/png"`,
  y `capture="environment"` para que en el celular abra la cámara), nota opcional.
  Botón `type="submit"`. Mientras sube, el botón queda deshabilitado y dice "Subiendo…".
- Si el servidor responde que la evidencia ya la presentó otra persona, muestra el mensaje y un botón
  **"Sí, fue una actividad conjunta"** que reenvía con `conjunta: true`. Nada de `window.confirm`.
- Lista de sus registros: fecha, clase, evidencia (link o "Ver foto" abriendo `drive_link` en pestaña
  nueva con `rel="noopener noreferrer"`), "registrado N días después" si aplica (reusa
  `diasDeAtraso` de `datos.js` pasándole `{ fecha, capturado_en: registrado_en }`), marca "Conjunta",
  resultados, y acciones "Anular" (pide motivo en un diálogo con scroll, no `prompt`) y
  "Agregar resultado". Los anulados se ven tachados con su motivo.
- Debe verse bien a 390 px: nada se sale del ancho; la tabla, si la hay, con scroll propio.

- [ ] **Paso 1 – 4:** TDD de `actividades.js` con
  `node --preserve-symlinks --preserve-symlinks-main --test src/objetivos/actividades.test.js`.
  Los componentes no llevan prueba unitaria: los prueba Claude en el navegador.
- [ ] **Paso 5:** `npx vite build` sin errores y `npx eslint src/objetivos src/GerenciaVentas.jsx`
  sin errores nuevos. Detente y reporta.

---

### Task 6: Pantalla del gerente y del cierre

**Archivos:**
- Crear: `src/objetivos/ActividadesGerente.jsx`
- Modificar: `src/GerenciaVentas.jsx` (montarla junto a `RepartoGerente`), `src/CierreObjetivos.jsx`

**`ActividadesGerente`:**
- Por clase: meta de tienda, asignado, **sin asignar en rojo si no es 0**, y el reparto por persona
  con "Sugerir partes iguales" y editar parte (mismo flujo y mismos diálogos de motivo que la venta;
  reutiliza `DialogosObjetivos.jsx` si encaja, sin romper la venta).
- Lista de actividades de la tienda del mes: persona, fecha, clase, evidencia, conjunta, resultados,
  anuladas tachadas. Filtro por persona y por clase (estado local, no query al servidor).
- Leyenda "Declaradas, no verificadas". Todo oculto de edición si el mes está cerrado.

**`CierreObjetivos`:**
- En el previo y en el cierre sellado, por persona, una columna o bloque "Actividades (declaradas, no
  verificadas)" con `declaradas / meta` por clase. **No se mezclan con la diferencia de SICAR.**

- [ ] **Paso 1:** `npx vite build` sin errores; `npx eslint` de los archivos tocados sin errores nuevos.
- [ ] **Paso 2:** detente y reporta con la lista de archivos tocados.

---

## Evidencia de entrega (por cada task)

1. Lista exacta de archivos creados/modificados.
2. La salida de los archivos de prueba de esa task (NO de la suite completa).
3. Qué pruebas viste en rojo antes de implementar, y por qué fallaban.
4. Cualquier cosa del plan que no coincidió con el código real.
5. Confirmación de que no tocaste `package.json`/locks ni archivos prohibidos.
