# Metas del corporativo F1 + F2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Metas propias para las cuentas del corporativo (manuales o contadas solas) y la visita mensual del supervisor
con checklist, fotos, GPS y fallas que resuelve el encargado con un paso a paso.

**Architecture:**
- **F1** agrega a las metas existentes:
  - el alcance `corporativo` (apunta a `usuario_id`);
  - un campo `fuente`;
  - un módulo puro `backend/metasFuentes.js`, que cuenta registros que ya existen.

  `resultadoMeta` decide si suma capturas o pregunta a la fuente, así que avance y sello heredan el cambio sin rutas
  nuevas.
- **F2** es un módulo nuevo `backend/supervision.js` (lógica pura sobre `DB.supervision`) con sus rutas en
  `backend/supervisionRutas.js` y pantallas en `src/supervision/`. Alimenta la fuente `visitas_tienda`.

**Tech Stack:** Node 22 + Express, estado JSON en SQLite (`guardar`), better-sqlite3 para `sicar_*`/`lead_*`, React +
Vite + Tailwind, pruebas con `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-22-metas-corporativo-f1-f2-design.md`

## Global Constraints

- Ninguna dependencia nueva.
- Ninguna línea de más de 200 caracteres en `backend/` ni `src/`.
- Nunca `git add .`: staging por rutas explícitas. Mensajes de commit sin acentos, terminados con:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` y
  `Claude-Session: https://claude.ai/code/session_01LctD6y51YMZMbpD8pi9WSJ`.
- Los archivos (fotos) van a Drive con `drive.subirArchivoADrive`, nunca al disco de Render.
- El alcance sale del token (`resolverAlcanceAutorizado`). Lo de fuera del alcance responde 404.
- Los ids que llegan del cuerpo se normalizan con `Number(...)` antes de comparar.
- Fechas solas con `fechaLocal()` y marcas con ISO UTC.
- Cada permiso nuevo va en `backend/permisosCatalogo.js`, con su módulo en `MODULOS_SISTEMA`.
- Seguimiento "a tiempo" = dentro de **2 días** (48 h) desde `fecha_registro`.
- Plazo de una falla: **7 días**.
- Radio de la visita: `RADIO_TOLERANCIA_METROS` (300 m, `backend/auth.js:289`).
- Una visita a una tienda sin coordenadas, o lejos de ella, se guarda pero no cuenta.
- Pruebas desde `backend/`:
  `node --preserve-symlinks --preserve-symlinks-main --test <archivo>`.
  Suite completa: `node --preserve-symlinks --preserve-symlinks-main --test`.
  Base: 3116 pasan, 0 fallan.
- Desviación del spec, por menos superficie en `drive.js`:
  - foto de una meta corporativa sin tienda → `drive.asegurarCarpetaEmpleado(DB, cuenta)`;
  - foto de una visita → `drive.asegurarCarpetaActividadesSucursal(DB, sucursal)`.

## Review Focus

1. **Un gerente de tienda con `anular_capturas_metas` sin alcance global** pide el tablero o la revisión de su
   tienda. No debe ver ninguna meta corporativa, aunque tenga su `sucursal_id`. Prueba en Task 4.
2. **La bandeja está apagada** (`sqlite` null, o sin tablas `lead_*`) y hay una meta `bandeja_respuestas`. El tablero
   debe responder: la meta con `resultado: 0` y `aviso`. Sellar debe rechazarse con un mensaje claro. No se debe caer
   ni sellar un cero falso. Prueba en Tasks 1 y 4.
3. **`usuario_id` llega como texto** (`"80"`) al crear la meta. Se debe guardar como número, y el dueño la debe ver.
   Prueba en Task 2.
4. **La cuenta dueña se desactiva** después de crear la meta. La meta se conserva para el historial, pero no puede
   capturar nadie: ni la cuenta inactiva ni otra. Prueba en Task 3.
5. **La foto de una falla llega con PNG o JPG falso** (firma incorrecta). Debe rechazarse con
   `prepararEvidencia` antes de subir a Drive. Prueba en Task 8.

---

## Task 1: Fuentes automáticas (`backend/metasFuentes.js`)

**Files:**
- Create: `backend/metasFuentes.js`
- Test: `backend/metasFuentes.test.js`

**Interfaces:**
- Produce:
  - `FUENTES`: arreglo con `["manual", "radar_seguimiento_a_tiempo", "crm_cambios_estado", "bandeja_respuestas",
    "revisiones_metas_tienda", "visitas_tienda"]`.
  - `DESCRIPCION_FUENTES`: objeto con una frase por fuente.
  - `configurarFuentes({ sqlite })`, que guarda la conexión a nivel de módulo.
  - `contarFuente(DB, meta)`, que devuelve `{ valor, detalle: [{clave, fecha, texto}], aviso: string|null }` para
    cualquier fuente distinta de `"manual"`.
  - Las fuentes de SQLite sin conexión, o con la tabla ausente, devuelven `{valor: 0, detalle: [], aviso: "..."}`.
- Consume: `finDePeriodo` de `./metasPeriodos` y `fechaLocal` de `./fechas`.

- [ ] **Step 1: Write the failing tests**

```js
// backend/metasFuentes.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { contarFuente, configurarFuentes, FUENTES } = require("./metasFuentes");

const MES = { periodo: "mensual", inicio: "2026-09-01" };
const meta = (fuente, extra = {}) => ({ clave: 1, alcance: "corporativo", usuario_id: 80, sucursal_id: null, fuente, ...MES, ...extra });
const DBBase = () => ({
  pos: { sucursales: [{ id: 1 }, { id: 2 }], meta_capturas: [] },
  crm: { clientes: [{ id: 5, sucursal_id: 1 }, { id: 6, sucursal_id: 2 }], estados_historial: [] },
  radar_demanda: { registros: [], seguimientos: [] },
  supervision: { visitas: [] },
});

test("catalogo cerrado de fuentes", () => {
  assert.deepEqual(FUENTES, ["manual", "radar_seguimiento_a_tiempo", "crm_cambios_estado", "bandeja_respuestas",
    "revisiones_metas_tienda", "visitas_tienda"]);
});

test("radar: cuenta el primer seguimiento propio dentro de 48 h, no el de 3 dias ni el ajeno", () => {
  const DB = DBBase();
  DB.radar_demanda.registros = [
    { id: 1, sucursal_id: 1, fecha_registro: "2026-09-10T15:00:00.000Z" },
    { id: 2, sucursal_id: 1, fecha_registro: "2026-09-10T15:00:00.000Z" },
    { id: 3, sucursal_id: 2, fecha_registro: "2026-09-10T15:00:00.000Z" },
  ];
  DB.radar_demanda.seguimientos = [
    { id: 1, demanda_id: 1, usuario_id: 80, fecha_hora: "2026-09-12T14:00:00.000Z" }, // 47 h: cuenta
    { id: 2, demanda_id: 1, usuario_id: 80, fecha_hora: "2026-09-12T16:00:00.000Z" }, // segundo: no
    { id: 3, demanda_id: 2, usuario_id: 80, fecha_hora: "2026-09-13T16:00:00.000Z" }, // 3 dias: no
    { id: 4, demanda_id: 3, usuario_id: 81, fecha_hora: "2026-09-10T16:00:00.000Z" }, // ajeno: no
  ];
  const r = contarFuente(DB, meta("radar_seguimiento_a_tiempo"));
  assert.equal(r.valor, 1);
  assert.equal(r.detalle[0].clave, "radar:1");
});

test("radar: primer seguimiento ajeno gana aunque luego siga el propio", () => {
  const DB = DBBase();
  DB.radar_demanda.registros = [{ id: 1, sucursal_id: 1, fecha_registro: "2026-09-10T15:00:00.000Z" }];
  DB.radar_demanda.seguimientos = [
    { id: 1, demanda_id: 1, usuario_id: 81, fecha_hora: "2026-09-10T16:00:00.000Z" },
    { id: 2, demanda_id: 1, usuario_id: 80, fecha_hora: "2026-09-10T17:00:00.000Z" },
  ];
  assert.equal(contarFuente(DB, meta("radar_seguimiento_a_tiempo")).valor, 0);
});

test("crm: cuenta cambios propios del periodo, ignora sistema, otros meses y otra tienda", () => {
  const DB = DBBase();
  DB.crm.estados_historial = [
    { id: 1, cliente_id: 5, usuario_id: 80, fecha_hora: "2026-09-03T18:00:00.000Z" },
    { id: 2, cliente_id: 5, usuario_id: null, fecha_hora: "2026-09-03T18:00:00.000Z" },
    { id: 3, cliente_id: 5, usuario_id: 80, fecha_hora: "2026-10-01T18:00:00.000Z" },
    { id: 4, cliente_id: 6, usuario_id: 80, fecha_hora: "2026-09-04T18:00:00.000Z" },
  ];
  assert.equal(contarFuente(DB, meta("crm_cambios_estado")).valor, 2);
  assert.equal(contarFuente(DB, meta("crm_cambios_estado", { sucursal_id: 1 })).valor, 1);
});

test("crm: suma los cambios de clientes SICAR de sqlite", () => {
  const sqlite = new Database(":memory:");
  sqlite.exec("CREATE TABLE sicar_estados_historial (id INTEGER PRIMARY KEY, sucursal_id INTEGER, cli_id TEXT, anterior TEXT, nuevo TEXT,"
    + " usuario_id INTEGER, fecha_hora TEXT)");
  sqlite.prepare("INSERT INTO sicar_estados_historial VALUES (1, 1, 'A', NULL, 'interesado', 80, '2026-09-05T18:00:00.000Z')").run();
  configurarFuentes({ sqlite });
  try {
    assert.equal(contarFuente(DBBase(), meta("crm_cambios_estado")).valor, 1);
  } finally { configurarFuentes({ sqlite: null }); }
});

test("bandeja: cuenta salientes propios; sin bandeja avisa y vale 0", () => {
  assert.deepEqual(contarFuente(DBBase(), meta("bandeja_respuestas")),
    { valor: 0, detalle: [], aviso: "La bandeja de mensajes no está disponible; esta meta no se puede contar ahora" });
  const sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE lead_fuentes (id INTEGER PRIMARY KEY, sucursal_responsable_id INTEGER);
    CREATE TABLE lead_conversaciones (id INTEGER PRIMARY KEY, fuente_id INTEGER);
    CREATE TABLE lead_interacciones (id INTEGER PRIMARY KEY, conversacion_id INTEGER, direccion TEXT, ocurrida_en TEXT, usuario_id INTEGER);
    INSERT INTO lead_fuentes VALUES (1, 1), (2, 2);
    INSERT INTO lead_conversaciones VALUES (10, 1), (11, 2);
    INSERT INTO lead_interacciones VALUES (1, 10, 'saliente', '2026-09-02T18:00:00.000Z', 80),
      (2, 10, 'entrante', '2026-09-02T18:00:00.000Z', NULL), (3, 11, 'saliente', '2026-09-02T18:00:00.000Z', 80),
      (4, 10, 'saliente', '2026-09-02T18:00:00.000Z', 81);`);
  configurarFuentes({ sqlite });
  try {
    assert.equal(contarFuente(DBBase(), meta("bandeja_respuestas")).valor, 2);
    assert.equal(contarFuente(DBBase(), meta("bandeja_respuestas", { sucursal_id: 1 })).valor, 1);
  } finally { configurarFuentes({ sqlite: null }); }
});

test("revisiones: revisada o anulada por la cuenta cuenta una vez por captura", () => {
  const DB = DBBase();
  DB.pos.meta_capturas = [
    { id: 1, sucursal_id: 1, revisada: { por_id: 80, en: "2026-09-05T18:00:00.000Z" }, anulada: { por_id: 80, en: "2026-09-06T18:00:00.000Z" } },
    { id: 2, sucursal_id: 1, revisada: null, anulada: { por_id: 80, en: "2026-09-06T18:00:00.000Z" } },
    { id: 3, sucursal_id: 1, revisada: { por_id: 81, en: "2026-09-06T18:00:00.000Z" }, anulada: null },
  ];
  assert.equal(contarFuente(DB, meta("revisiones_metas_tienda")).valor, 2);
});

test("visitas: una por tienda y mes, solo terminadas y con ubicacion comprobada", () => {
  const DB = DBBase();
  const v = (id, sucursal_id, estado, comprobada) => ({ id, sucursal_id, mes: "2026-09", supervisor_id: 80, estado,
    terminada_en: "2026-09-08T18:00:00.000Z", ubicacion: { comprobada } });
  DB.supervision.visitas = [v(1, 1, "terminada", true), v(2, 1, "terminada", true), v(3, 2, "terminada", false), v(4, 2, "en_curso", true)];
  assert.equal(contarFuente(DB, meta("visitas_tienda")).valor, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --preserve-symlinks --preserve-symlinks-main --test metasFuentes.test.js`
Expected: FAIL con "Cannot find module './metasFuentes'"

- [ ] **Step 3: Implement**

```js
// backend/metasFuentes.js
// Metas que se cuentan solas (spec 2026-10-22 §4.2): cada fuente lee registros que ya guardan quién (usuario_id)
// y cuándo. Lo que no tiene usuario_id no se le atribuye a nadie. Cada renglón cuenta una vez por su clave.
const { finDePeriodo } = require("./metasPeriodos");
const { fechaLocal } = require("./fechas");

const HORAS_SEGUIMIENTO = 48;
const FUENTES = ["manual", "radar_seguimiento_a_tiempo", "crm_cambios_estado", "bandeja_respuestas",
  "revisiones_metas_tienda", "visitas_tienda"];
const DESCRIPCION_FUENTES = {
  manual: "Se marca \"Hecho\" con su prueba",
  radar_seguimiento_a_tiempo: "Demandas del Radar a las que diste el primer seguimiento antes de 2 días",
  crm_cambios_estado: "Cambios de estado de clientes que hiciste en el CRM",
  bandeja_respuestas: "Mensajes que respondiste desde la bandeja",
  revisiones_metas_tienda: "Capturas de metas de tienda que revisaste o anulaste",
  visitas_tienda: "Visitas a tienda terminadas y con ubicación comprobada (una por tienda al mes)",
};

let conexion = null;
function configurarFuentes({ sqlite }) { conexion = sqlite || null; }

const diaDe = (iso) => fechaLocal(new Date(iso));
function enPeriodo(meta, iso) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return false;
  const dia = diaDe(iso);
  return dia >= meta.inicio && dia <= finDePeriodo(meta.periodo, meta.inicio);
}
const deTienda = (meta, sucursalId) => meta.sucursal_id == null || Number(sucursalId) === Number(meta.sucursal_id);
const esDe = (meta, usuarioId) => usuarioId != null && Number(usuarioId) === Number(meta.usuario_id);
const resultado = (detalle, aviso = null) => ({ valor: detalle.length, detalle, aviso });

function tablaExiste(nombre) {
  return !!conexion?.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(nombre);
}

function radarSeguimiento(DB, meta) {
  const registros = new Map((DB.radar_demanda?.registros || []).map((r) => [Number(r.id), r]));
  const primero = new Map();
  for (const s of DB.radar_demanda?.seguimientos || []) {
    const previo = primero.get(Number(s.demanda_id));
    if (!previo || Date.parse(s.fecha_hora) < Date.parse(previo.fecha_hora)) primero.set(Number(s.demanda_id), s);
  }
  const detalle = [];
  for (const [demandaId, s] of primero) {
    const registro = registros.get(demandaId);
    if (!registro || !esDe(meta, s.usuario_id) || !enPeriodo(meta, s.fecha_hora) || !deTienda(meta, registro.sucursal_id)) continue;
    const horas = (Date.parse(s.fecha_hora) - Date.parse(registro.fecha_registro)) / 3600000;
    if (horas >= 0 && horas <= HORAS_SEGUIMIENTO) {
      detalle.push({ clave: `radar:${demandaId}`, fecha: diaDe(s.fecha_hora), texto: `Seguimiento a la demanda #${demandaId}` });
    }
  }
  return resultado(detalle);
}

function crmCambios(DB, meta) {
  const tiendaDe = new Map((DB.crm?.clientes || []).map((c) => [Number(c.id), c.sucursal_id]));
  const detalle = (DB.crm?.estados_historial || [])
    .filter((h) => esDe(meta, h.usuario_id) && enPeriodo(meta, h.fecha_hora) && deTienda(meta, tiendaDe.get(Number(h.cliente_id))))
    .map((h) => ({ clave: `crm:${h.id}`, fecha: diaDe(h.fecha_hora), texto: `Cliente #${h.cliente_id}: ${h.anterior || "sin estado"} → ${h.nuevo}` }));
  if (tablaExiste("sicar_estados_historial")) {
    const filas = conexion.prepare("SELECT id, sucursal_id, cli_id, anterior, nuevo, fecha_hora FROM sicar_estados_historial WHERE usuario_id = ?")
      .all(Number(meta.usuario_id));
    for (const f of filas) {
      if (!enPeriodo(meta, f.fecha_hora) || !deTienda(meta, f.sucursal_id)) continue;
      detalle.push({ clave: `sicar:${f.id}`, fecha: diaDe(f.fecha_hora), texto: `Cliente SICAR ${f.cli_id}: ${f.anterior || "sin estado"} → ${f.nuevo}` });
    }
  }
  return resultado(detalle);
}

function bandejaRespuestas(meta) {
  if (!["lead_interacciones", "lead_conversaciones", "lead_fuentes"].every(tablaExiste)) {
    return resultado([], "La bandeja de mensajes no está disponible; esta meta no se puede contar ahora");
  }
  const filas = conexion.prepare(`SELECT i.id, i.ocurrida_en, f.sucursal_responsable_id AS sucursal_id FROM lead_interacciones i
    JOIN lead_conversaciones c ON c.id = i.conversacion_id LEFT JOIN lead_fuentes f ON f.id = c.fuente_id
    WHERE i.direccion = 'saliente' AND i.usuario_id = ?`).all(Number(meta.usuario_id));
  return resultado(filas.filter((f) => enPeriodo(meta, f.ocurrida_en) && deTienda(meta, f.sucursal_id))
    .map((f) => ({ clave: `msg:${f.id}`, fecha: diaDe(f.ocurrida_en), texto: "Respuesta en la bandeja" })));
}

function revisiones(DB, meta) {
  const detalle = [];
  for (const c of DB.pos?.meta_capturas || []) {
    if (!deTienda(meta, c.sucursal_id)) continue;
    const marca = [c.revisada, c.anulada].find((m) => m && esDe(meta, m.por_id) && enPeriodo(meta, m.en));
    if (marca) detalle.push({ clave: `cap:${c.id}`, fecha: diaDe(marca.en), texto: `Captura #${c.id} revisada` });
  }
  return resultado(detalle);
}

function visitas(DB, meta) {
  const vistas = new Map();
  for (const v of DB.supervision?.visitas || []) {
    if (v.estado !== "terminada" || !v.ubicacion?.comprobada || !esDe(meta, v.supervisor_id)) continue;
    if (!enPeriodo(meta, v.terminada_en) || !deTienda(meta, v.sucursal_id)) continue;
    const clave = `visita:${v.sucursal_id}:${v.mes}`;
    if (!vistas.has(clave)) vistas.set(clave, { clave, fecha: diaDe(v.terminada_en), texto: `Visita a tienda ${v.sucursal_id} (${v.mes})` });
  }
  return resultado([...vistas.values()]);
}

const CONTADORES = {
  radar_seguimiento_a_tiempo: radarSeguimiento, crm_cambios_estado: crmCambios,
  bandeja_respuestas: (DB, meta) => bandejaRespuestas(meta), revisiones_metas_tienda: revisiones, visitas_tienda: visitas,
};

function contarFuente(DB, meta) {
  const contar = CONTADORES[meta.fuente];
  if (!contar) throw new Error(`Fuente de meta desconocida: ${meta.fuente}`);
  return contar(DB, meta);
}

module.exports = { FUENTES, DESCRIPCION_FUENTES, HORAS_SEGUIMIENTO, configurarFuentes, contarFuente };
```

- [ ] **Step 4: Run to verify it passes.** Same command. Expected: 9 pass.
- [ ] **Step 5: Commit**

```bash
git add backend/metasFuentes.js backend/metasFuentes.test.js
git commit -m "feat(metas): fuentes automaticas que cuentan trabajo ya registrado"
```

---

## Task 2: Alcance `corporativo` y campo `fuente` en las metas

**Files:**
- Modify: `backend/metasPersonalizadas.js:6-58, 132-172`
- Test: `backend/metasPersonalizadas.test.js` (agregar al final)

**Interfaces:**
- Consume: `FUENTES` de Task 1.
- Produce:
  - `crearMeta(DB, {..., alcance: "corporativo", usuario_id, sucursal_id?, fuente?})` devuelve una meta con
    `usuario_id: number`, `vendedor_id: null`, `participantes: []`, `sucursal_id: number|null` y `fuente: string`
    (por omisión `"manual"`).
  - `fuenteDe(meta)` devuelve `meta.fuente || "manual"`.
  - `ALCANCES` incluye `"corporativo"`.

- [ ] **Step 1: Failing tests** (al final de `metasPersonalizadas.test.js`; usar su `DBPrueba` local y agregarle
  `admin: { usuarios: [{ id: 80, nombre: "Sofía", activo: true }, { id: 81, nombre: "Baja", activo: false }] }`)

```js
const CORP = { nombre: "Seguimiento Radar", unidad: "demandas", prueba: "ninguna", valor_meta: 20, periodo: "mensual", inicio: "2026-11-01",
  alcance: "corporativo", usuario_id: "80" };

test("corporativo: guarda usuario_id numerico, tienda opcional y fuente manual por omision", () => {
  const DB = DBPrueba();
  const meta = M.crearMeta(DB, CORP, VICTOR);
  assert.equal(meta.usuario_id, 80);
  assert.equal(meta.vendedor_id, null);
  assert.equal(meta.sucursal_id, null);
  assert.equal(meta.fuente, "manual");
  assert.equal(M.crearMeta(DB, { ...CORP, sucursal_id: "1" }, VICTOR).sucursal_id, 1);
});

test("corporativo: cuenta inactiva, inexistente o tienda inexistente se rechazan", () => {
  const DB = DBPrueba();
  assert.throws(() => M.crearMeta(DB, { ...CORP, usuario_id: 81 }, VICTOR), /cuenta activa/);
  assert.throws(() => M.crearMeta(DB, { ...CORP, usuario_id: 99 }, VICTOR), /cuenta activa/);
  assert.throws(() => M.crearMeta(DB, { ...CORP, sucursal_id: 77 }, VICTOR), /La tienda no existe/);
});

test("fuente automatica: solo corporativo, sin prueba, y no editable", () => {
  const DB = DBPrueba();
  const auto = M.crearMeta(DB, { ...CORP, fuente: "crm_cambios_estado" }, VICTOR);
  assert.equal(auto.fuente, "crm_cambios_estado");
  assert.throws(() => M.crearMeta(DB, { ...CORP, fuente: "inventada" }, VICTOR), /fuente/);
  assert.throws(() => M.crearMeta(DB, { ...CORP, fuente: "crm_cambios_estado", prueba: "foto" }, VICTOR), /se cuenta sola/);
  assert.throws(() => M.crearMeta(DB, { ...CORP, alcance: "tienda", sucursal_id: 1, fuente: "crm_cambios_estado" }, VICTOR), /corporativo/);
  assert.throws(() => M.editarMeta(DB, auto.clave, { fuente: "manual", motivo: "x" }, VICTOR), /no se pueden cambiar/);
});

test("metas existentes sin fuente se leen como manual", () => {
  assert.equal(M.fuenteDe({}), "manual");
});
```

- [ ] **Step 2: Run to fail.** `node --preserve-symlinks --preserve-symlinks-main --test metasPersonalizadas.test.js`.
  Expected: FAIL, "El alcance debe ser tienda, persona o empresa".
- [ ] **Step 3: Implement.** En `metasPersonalizadas.js`:

```js
const { FUENTES } = require("./metasFuentes");
const ALCANCES = ["tienda", "persona", "empresa", "corporativo"];
const fuenteDe = (meta) => meta.fuente || "manual";
```

Dentro de `validarAlcance`, antes de la rama `persona`, agregar la rama `corporativo`. Cambiar el mensaje del primer
`throw` a `"El alcance debe ser tienda, persona, empresa o corporativo"`:

```js
  if (alcance === "corporativo") {
    const cuenta = (DB.admin?.usuarios || []).find((u) => u.id === Number(usuario_id) && u.activo !== false);
    if (!cuenta) throw new Error("La meta del corporativo necesita una cuenta activa");
    let tienda = null;
    if (sucursal_id !== undefined && sucursal_id !== null && sucursal_id !== "") {
      tienda = Number(sucursal_id);
      if (!DB.pos.sucursales.some((s) => s.id === tienda)) throw new Error("La tienda no existe");
    }
    return { alcance, sucursal_id: tienda, vendedor_id: null, usuario_id: cuenta.id, participantes: [] };
  }
```

- La firma pasa a `validarAlcance(DB, { alcance, sucursal_id, vendedor_id, participantes, usuario_id })`.
- Las otras ramas devuelven además `usuario_id: null`.
- `crearOkr` también acepta corporativo, sin cambios extra.

En `crearMeta`, después de `validarAlcance`:

```js
  const fuente = datos.fuente === undefined || datos.fuente === null ? "manual" : datos.fuente;
  if (!FUENTES.includes(fuente)) throw new Error("La fuente de la meta no es válida");
  if (fuente !== "manual") {
    if (alcance.alcance !== "corporativo") throw new Error("Solo las metas del corporativo se pueden contar solas");
    if (prueba !== "ninguna") throw new Error("Una meta que se cuenta sola no lleva prueba");
  }
```

- Agregar `fuente` al objeto `meta`.
- `editarMeta` ya rechaza `fuente` porque no está en `EDITABLES_META`. El mensaje existente contiene
  "no se pueden cambiar".
- Si `"prueba"` viene en la edición de una meta automática con un valor distinto de `"ninguna"`, lanzar
  `"Una meta que se cuenta sola no lleva prueba"`.
- Exportar `fuenteDe`.
- **Dependencia circular:** `metasFuentes` no importa `metasPersonalizadas`, así que no hay ciclo.

- [ ] **Step 4: Run.** Expected: todos pasan, incluidos los existentes.
- [ ] **Step 5: Commit** `git add backend/metasPersonalizadas.js backend/metasPersonalizadas.test.js`, mensaje
  `feat(metas): alcance corporativo por cuenta y fuente de la meta`.

---

## Task 3: Captura corporativa manual, rechazo de automáticas y marca "revisada"

**Files:**
- Modify: `backend/metasCapturas.js:29-44, 75-93, 97-170`
- Test: `backend/metasCapturas.test.js` (agregar)

**Interfaces:**
- Consume: `fuenteDe` de Task 2.
- Produce:
  - `capturarMeta(DB, clave, datos, { usuario, vendedor_id, drive, hoy })`, sin cambio de firma. Para una meta
    corporativa la dueña sale de `usuario.id`.
  - `validarParticipacion(DB, meta, vendedor_id, fecha, usuario_id = null)`.
  - `marcarRevisada(DB, id, usuario)` devuelve la captura con `revisada: {por_id, por_nombre, en}`.
  - Las capturas corporativas guardan `usuario_id` y `vendedor_id: null`.
  - `operacionPrevia` compara por `vendedor_id` o por `usuario_id` según el caso.

- [ ] **Step 1: Failing tests.** Agregar `admin.usuarios` con 80 activo y 82 activo al `DBPrueba` del archivo.

```js
const SOFIA = { id: 80, nombre: "Sofía" };
const metaCorp = (DB, extra = {}) => M.crearMeta(DB, { nombre: "Visitas proveedores", unidad: "visitas", prueba: "ninguna", valor_meta: 4,
  ...MES, alcance: "corporativo", usuario_id: 80, ...extra }, VICTOR);

test("corporativo manual: captura la duena sin vendedor ni plantilla", async () => {
  const DB = DBPrueba();
  const meta = metaCorp(DB);
  const c = await capturarMeta(DB, meta.clave, { fecha: "2026-09-10", cantidad: 2 }, { usuario: SOFIA, vendedor_id: null, drive: driveFalso, hoy: HOY });
  assert.equal(c.usuario_id, 80);
  assert.equal(c.vendedor_id, null);
  assert.equal(c.sucursal_id, null);
});

test("corporativo manual: otra cuenta o un vendedor no capturan", async () => {
  const DB = DBPrueba();
  const meta = metaCorp(DB);
  await assert.rejects(capturarMeta(DB, meta.clave, { fecha: "2026-09-10", cantidad: 1 },
    { usuario: { id: 82, nombre: "Otro" }, vendedor_id: null, drive: driveFalso, hoy: HOY }), /no es tuya/);
  await assert.rejects(capturarMeta(DB, meta.clave, { fecha: "2026-09-10", cantidad: 1 },
    { usuario: ANA, vendedor_id: 1, drive: driveFalso, hoy: HOY }), /no es tuya/);
});

test("corporativo: la cuenta desactivada ya no captura", async () => {
  const DB = DBPrueba();
  const meta = metaCorp(DB);
  DB.admin.usuarios.find((u) => u.id === 80).activo = false;
  await assert.rejects(capturarMeta(DB, meta.clave, { fecha: "2026-09-10", cantidad: 1 },
    { usuario: SOFIA, vendedor_id: null, drive: driveFalso, hoy: HOY }), /cuenta no está activa/);
});

test("meta automatica rechaza toda captura", async () => {
  const DB = DBPrueba();
  const meta = metaCorp(DB, { fuente: "crm_cambios_estado" });
  await assert.rejects(capturarMeta(DB, meta.clave, { fecha: "2026-09-10", cantidad: 1 },
    { usuario: SOFIA, vendedor_id: null, drive: driveFalso, hoy: HOY }), { message: "Esta meta se cuenta sola" });
});

test("corporativo con foto y sin tienda sube a la carpeta de la cuenta", async () => {
  const DB = DBPrueba();
  const meta = metaCorp(DB, { prueba: "foto" });
  let carpeta = null;
  const drive = { ...driveFalso, asegurarCarpetaEmpleado: async (db, cuenta) => { carpeta = cuenta.id; return "carpeta-cuenta"; } };
  const archivo = { contenido_base64: "/9j/2Q==", tipo_mime: "image/jpeg", nombre_archivo: "f.jpg" };
  await capturarMeta(DB, meta.clave, { fecha: "2026-09-10", archivo }, { usuario: SOFIA, vendedor_id: null, drive, hoy: HOY });
  assert.equal(carpeta, 80);
});

test("marcarRevisada: una sola vez, guarda quien y no cambia la cantidad", async () => {
  const DB = DBPrueba();
  const meta = metaTienda(DB, "ninguna");
  const c = await capturar(DB, meta.clave, { fecha: "2026-09-14", cantidad: 3 });
  const r = marcarRevisada(DB, c.id, VICTOR);
  assert.equal(r.revisada.por_id, 1);
  assert.equal(r.cantidad, 3);
  assert.throws(() => marcarRevisada(DB, c.id, VICTOR), /ya está revisada/);
});
```

Importar `marcarRevisada`. **Ojo con `metaTienda(DB, "ninguna")`:** la meta de tienda con prueba `ninguna` exige que la
vendedora esté en la plantilla, o que su `sucursal_id` sea 4 como Ana, como ya pasa en el archivo.

- [ ] **Step 2: Run to fail.** Expected: `marcarRevisada is not a function` y "Tu cuenta no está ligada a un vendedor".
- [ ] **Step 3: Implement.** En `metasCapturas.js`:

```js
const { metaVigente, periodoSellado, motivoObligatorio, fuenteDe } = require("./metasPersonalizadas");

function validarParticipacion(DB, meta, vendedor_id, fecha, usuario_id = null) {
  if (meta.alcance === "corporativo") {
    if (usuario_id === null || Number(usuario_id) !== meta.usuario_id) throw new Error("Esta meta no es tuya");
    const cuenta = (DB.admin?.usuarios || []).find((u) => u.id === meta.usuario_id);
    if (!cuenta || cuenta.activo === false) throw new Error("Tu cuenta no está activa; no puede capturar");
    return meta.sucursal_id;
  }
  if (vendedor_id === null || vendedor_id === undefined) throw new Error("Tu cuenta no está ligada a un vendedor");
  // ...resto sin cambios
}
```

- **`operacionPrevia(DB, operacion_id, dueno, clave)`:** `dueno` es `{vendedor_id, usuario_id}`. Para una meta
  corporativa busca por `c.usuario_id === usuario_id && c.vendedor_id == null`; para las demás, por `vendedor_id`.
  Las tres llamadas se cambian para pasar `{ vendedor_id, usuario_id: usuario?.id ?? null }`.
- **En `capturarMeta`:** después de `metaVigente`, agregar
  `if (fuenteDe(meta) !== "manual") throw new Error("Esta meta se cuenta sola");`. Pasar `usuario?.id` a
  `validarParticipacion` en las dos llamadas. Agregar `usuario_id: vigente.alcance === "corporativo" ? vigente.usuario_id : null`
  al objeto `captura`, y `revisada: null`.
- **`subirFoto`:** si `meta.alcance === "corporativo" && meta.sucursal_id === null`, la carpeta sale de
  `await drive.asegurarCarpetaEmpleado(DB, cuenta)`, con `cuenta` de `DB.admin.usuarios` por `meta.usuario_id`. El
  nombre del archivo usa `cuenta.nombre`. En los demás casos queda como hoy.
- **`marcarRevisada`:**

```js
function marcarRevisada(DB, id, usuario) {
  const captura = DB.pos.meta_capturas.find((c) => c.id === Number(id));
  if (!captura) throw new Error("La captura no existe");
  if (captura.revisada) throw new Error("La captura ya está revisada");
  if (captura.anulada) throw new Error("La captura está anulada; no se puede marcar revisada");
  if (periodoSellado(DB, captura.periodo, captura.inicio)) throw new Error("El periodo ya está sellado; no se puede revisar");
  captura.revisada = { por_id: usuario?.id ?? null, por_nombre: usuario?.nombre || "desconocido", en: new Date().toISOString() };
  return captura;
}
```

Exportar `marcarRevisada`.

- [ ] **Step 4: Run** `metasCapturas.test.js` y `metasAvance.test.js`. Expected: todo verde.
- [ ] **Step 5: Commit** `feat(metas): captura del corporativo, metas automaticas sin captura y marca revisada`.

---

## Task 4: Avance, visibilidad y sello de metas corporativas y automáticas

**Files:**
- Modify: `backend/metasAvance.js:10-138`, `backend/metasSellos.js:11-41`
- Test: `backend/metasAvance.test.js` y `backend/metasSellos.test.js` (agregar)

**Interfaces:**
- Consume: `contarFuente` (Task 1), `fuenteDe` (Task 2) y `validarParticipacion(..., usuario_id)` (Task 3).
- Produce:
  - el visor ahora es `{ vendedor_id, usuario_id, jefatura, verTodas, sucursalId }`;
  - `tablero(DB, visor, {periodo, inicio, sucursal_id, vendedor_id, usuario_id})`;
  - cada avance agrega `fuente`, `usuario_id`, `detalle` (solo en automáticas) y `aviso`;
  - `resultadoMeta(DB, meta)` devuelve el número de la fuente en las automáticas;
  - el sello rechaza si alguna automática trae `aviso`;
  - `previo.resultados[i]` agrega `fuente` y `detalle`.

- [ ] **Step 1: Failing tests** (`metasAvance.test.js`, con su `DBPrueba` más `admin.usuarios` y `crm.estados_historial`)

```js
const visorCorp = { vendedor_id: null, usuario_id: 80, jefatura: false, verTodas: false, sucursalId: 1 };

test("corporativo: la duena ve su meta y su avance automatico con detalle", () => {
  const DB = DBPrueba();
  DB.crm = { clientes: [{ id: 5, sucursal_id: 1 }], estados_historial: [
    { id: 1, cliente_id: 5, usuario_id: 80, anterior: null, nuevo: "interesado", fecha_hora: "2026-09-03T18:00:00.000Z" }] };
  M.crearMeta(DB, { nombre: "CRM", unidad: "cambios", prueba: "ninguna", valor_meta: 4, periodo: "mensual", inicio: "2026-09-01",
    alcance: "corporativo", usuario_id: 80, fuente: "crm_cambios_estado" }, VICTOR);
  const t = tablero(DB, visorCorp, { periodo: "mensual", inicio: "2026-09-01" }, "2026-09-15");
  assert.equal(t.sueltas.length, 1);
  assert.equal(t.sueltas[0].resultado, 1);
  assert.equal(t.sueltas[0].detalle.length, 1);
  assert.equal(t.sueltas[0].puede_capturar, false);
});

test("corporativo: gerente de tienda sin alcance global no la ve aunque sea de su tienda", () => {
  const DB = DBPrueba();
  M.crearMeta(DB, { nombre: "Visitas", unidad: "visitas", prueba: "ninguna", valor_meta: 1, periodo: "mensual", inicio: "2026-09-01",
    alcance: "corporativo", usuario_id: 80, sucursal_id: 1 }, VICTOR);
  const gerente = { vendedor_id: null, usuario_id: 90, jefatura: true, verTodas: false, sucursalId: 1 };
  assert.equal(tablero(DB, gerente, { periodo: "mensual", inicio: "2026-09-01" }, "2026-09-15").sueltas.length, 0);
  const victor = { vendedor_id: null, usuario_id: 1, jefatura: true, verTodas: true, sucursalId: 1 };
  assert.equal(tablero(DB, victor, { periodo: "mensual", inicio: "2026-09-01" }, "2026-09-15").sueltas.length, 1);
  assert.equal(tablero(DB, { ...visorCorp, usuario_id: 82 }, { periodo: "mensual", inicio: "2026-09-01" }, "2026-09-15").sueltas.length, 0);
});

test("corporativo manual: la duena puede capturar dentro del periodo", () => {
  const DB = DBPrueba();
  M.crearMeta(DB, { nombre: "Llamadas", unidad: "llamadas", prueba: "ninguna", valor_meta: 5, periodo: "mensual", inicio: "2026-09-01",
    alcance: "corporativo", usuario_id: 80 }, VICTOR);
  assert.equal(tablero(DB, visorCorp, { periodo: "mensual", inicio: "2026-09-01" }, "2026-09-15").sueltas[0].puede_capturar, true);
});

test("filtro por usuario_id en el tablero de jefatura", () => {
  const DB = DBPrueba();
  M.crearMeta(DB, { nombre: "A", unidad: "u", prueba: "ninguna", valor_meta: 1, periodo: "mensual", inicio: "2026-09-01",
    alcance: "corporativo", usuario_id: 80 }, VICTOR);
  const victor = { vendedor_id: null, usuario_id: 1, jefatura: true, verTodas: true, sucursalId: 1 };
  assert.equal(tablero(DB, victor, { periodo: "mensual", inicio: "2026-09-01", usuario_id: 82 }, "2026-09-15").sueltas.length, 0);
  assert.equal(tablero(DB, victor, { periodo: "mensual", inicio: "2026-09-01", usuario_id: 80 }, "2026-09-15").sueltas.length, 1);
});
```

En `metasSellos.test.js`:

```js
test("sello: congela el valor automatico y rechaza si la fuente no esta disponible", () => {
  const DB = DBPrueba(); // agregar admin.usuarios [{id:80, activo:true}] y crm
  DB.crm = { clientes: [{ id: 5, sucursal_id: 1 }], estados_historial: [
    { id: 1, cliente_id: 5, usuario_id: 80, nuevo: "interesado", fecha_hora: "2026-09-03T18:00:00.000Z" }] };
  const meta = M.crearMeta(DB, { nombre: "CRM", unidad: "cambios", prueba: "ninguna", valor_meta: 4, periodo: "mensual", inicio: "2026-09-01",
    alcance: "corporativo", usuario_id: 80, fuente: "crm_cambios_estado" }, VICTOR);
  const previo = previoSello(DB, { periodo: "mensual", inicio: "2026-09-01" }, "2026-10-02");
  sellarPeriodo(DB, { periodo: "mensual", inicio: "2026-09-01", huella: previo.huella }, VICTOR, "2026-10-02");
  DB.crm.estados_historial.push({ id: 2, cliente_id: 5, usuario_id: 80, nuevo: "compro", fecha_hora: "2026-09-20T18:00:00.000Z" });
  assert.equal(resultadoRectificado(DB, meta), 1);
  const DB2 = DBPrueba();
  M.crearMeta(DB2, { nombre: "Bandeja", unidad: "mensajes", prueba: "ninguna", valor_meta: 4, periodo: "mensual", inicio: "2026-09-01",
    alcance: "corporativo", usuario_id: 80, fuente: "bandeja_respuestas" }, VICTOR);
  assert.throws(() => previoSello(DB2, { periodo: "mensual", inicio: "2026-09-01" }, "2026-10-02"), /no se puede contar/);
});
```

(Importar `resultadoRectificado` desde `./metasAvance`.)

- [ ] **Step 2: Run to fail.**
- [ ] **Step 3: Implement** en `metasAvance.js`:

```js
const { periodoSellado, fuenteDe } = require("./metasPersonalizadas");
const { contarFuente } = require("./metasFuentes");

function conteoAutomatico(DB, meta) { return fuenteDe(meta) === "manual" ? null : contarFuente(DB, meta); }

function resultadoMeta(DB, meta) {
  const auto = conteoAutomatico(DB, meta);
  if (auto) return auto.valor;
  return validas(DB, meta).reduce((suma, c) => suma + c.cantidad, 0);
}
```

- **En `puedeVer`, al principio:**

```js
  if (meta.alcance === "corporativo") return meta.usuario_id === visor.usuario_id || (visor.jefatura && visor.verTodas);
```

- **En la rama `visor.jefatura` sin `verTodas`:** se agrega el corporativo a lo que excluye:
  `return !["empresa", "corporativo"].includes(meta.alcance) && meta.sucursal_id === visor.sucursalId;`.
  Ojo: el `return` del corporativo de arriba ya lo resuelve antes. Esta línea es defensa extra.
- **`puedeCapturar(DB, meta, visor, hoy)`:** cambia la firma para recibir el visor.
  - Si `fuenteDe(meta) !== "manual"`, devuelve `false`.
  - Si es corporativo, devuelve `meta.usuario_id === visor.usuario_id && hoy >= meta.inicio && !periodoSellado(...)`,
    con un try de `validarParticipacion(DB, meta, null, hoy, visor.usuario_id)`.
  - Si no, sigue con `visor.vendedor_id` como hoy.
- **`capturasPropias(DB, meta, visor)`:** si es corporativo, filtra `c.usuario_id === visor.usuario_id`; si no, filtra
  por vendedor. Se actualizan sus 3 usos.
- **En `avanceMeta`:**
  - calcula `const auto = conteoAutomatico(DB, meta);`;
  - el resultado sigue saliendo de `resultadoRectificado` (que llama a `resultadoMeta`);
  - agrega `fuente: fuenteDe(meta)`, `usuario_id: meta.usuario_id ?? null`,
    `detalle: auto && !selloDe(...) ? auto.detalle : (selladoDetalle || [])` y `aviso: auto?.aviso || null`;
  - `selladoDetalle` es el `detalle` del resultado sellado, cuando existe.
- **En `tablero`:** agrega `usuario_id = null` a los parámetros y al filtro: `(usuario_id === null || m.usuario_id === usuario_id)`.

En `metasSellos.js`, `previoSello`:

```js
const { contarFuente } = require("./metasFuentes");
const { fuenteDe } = require("./metasPersonalizadas");
// dentro de resultados.map:
      const auto = fuenteDe(m) === "manual" ? null : contarFuente(DB, m);
      if (auto?.aviso) throw new Error(`No se puede sellar "${m.nombre}": ${auto.aviso}`);
      const resultado = auto ? auto.valor : resultadoMeta(DB, m);
      return { ..., fuente: fuenteDe(m), detalle: auto ? auto.detalle : null };
```

- La huella ya incluye `resultados` (clave y resultado). Si el conteo automático cambia entre revisar y sellar, da 409,
  como debe.
- No se toca nada más del sello.

- [ ] **Step 4: Run** `metasAvance.test.js`, `metasSellos.test.js`, `metasCapturas.test.js` y `metasRutas.test.js`.
  Expected: verde.
- [ ] **Step 5: Commit** `feat(metas): avance y sello de metas del corporativo y automaticas`.

---

## Task 5: Rutas y conexión en `server.js`

**Files:**
- Modify: `backend/metasRutas.js`, `backend/server.js` (bloque de `require("./metasRutas")` en la línea ~3102, y la
  configuración de fuentes junto a la creación de la bandeja en la línea ~1914)
- Test: `backend/metasCorporativoRutas.test.js` (nuevo, molde de `metasRutas.test.js`)

**Interfaces:**
- Consume: Tasks 1–4.
- Produce:
  - `GET /api/metas/tablero?...&usuario_id=` incluye las metas corporativas;
  - `POST /api/metas/:clave/captura` para corporativas usa `req.usuarioToken.id`;
  - `POST /api/metas/captura/:id/revisada` con el permiso `anular_capturas_metas` y `capturaEnAlcance`;
  - `GET /api/metas/personas-corporativo` con el permiso `administrar_metas_personalizadas`. Devuelve
    `[{id, nombre, rol}]` de las cuentas activas, sin `password_hash`;
  - `GET /api/metas/fuentes` (`administrar_metas_personalizadas`) devuelve `[{clave, descripcion}]`.

- [ ] **Step 1: Failing tests.**
  - **Cuentas de prueba:** admin (rol 1), "Supervisor" sin vendedor (rol con `usar_gerente_ventas`, id 80) y
    "Gerente" de tienda 1 (rol con `usar_gerente_ventas`, `anular_capturas_metas`).
  - **Casos:**
    1. Admin crea una meta corporativa manual para 80, y 80 la ve en `/api/metas/tablero`.
    2. 80 captura con `POST /api/metas/:clave/captura` y recibe 200.
    3. Gerente captura la meta de 80 y recibe 400 "Esta meta no es tuya".
    4. El tablero del gerente no trae la meta, aunque tenga `sucursal_id: 1`.
    5. Admin crea una automática `crm_cambios_estado`. `PUT /api/crm/clientes/:id/estado` con el token de 80 sube el
       resultado a 1.
    6. `revisada` sobre una captura de otra tienda da 404 para el gerente, y 200 sobre una de su tienda.
    7. `personas-corporativo` no trae `password_hash` y da 403 al gerente.
  - Patrón de llamadas: `fetch(base + ruta, { headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" } })`.
  - Permisos vecinos, no `permisos: []`: el rol del gerente lleva `usar_gerente_ventas` y `editar_objetivos_venta`.

- [ ] **Step 2: Run to fail.**
- [ ] **Step 3: Implement.**
  - En `metasRutas.js`, `visorDe(req)` agrega `usuario_id: req.usuarioToken.id`.
  - El tablero pasa `usuario_id: opcional(req.query.usuario_id, "usuario_id")`.
  - Captura: sin cambios (`usuario: req.usuarioToken` ya viaja).
  - Anular propia: `propia` agrega `|| (captura.usuario_id != null && captura.usuario_id === req.usuarioToken.id)`.
  - Rutas nuevas:

```js
  app.post("/api/metas/captura/:id/revisada", requiereLogin, permiso("anular_capturas_metas"), (req, res) => {
    try {
      const id = idDeObjetivos(req.params.id, "id");
      const captura = DB.pos.meta_capturas.find((c) => c.id === id);
      if (!captura || !capturaEnAlcance(req, captura)) return res.status(404).json({ error: "Captura no encontrada" });
      res.json(capturaParaRespuesta(marcarRevisada(DB, id, req.usuarioToken)));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.get("/api/metas/personas-corporativo", requiereLogin, admin, (req, res) => res.json(DB.admin.usuarios
    .filter((u) => u.activo !== false)
    .map((u) => ({ id: u.id, nombre: u.nombre, rol: DB.admin.roles.find((r) => r.id === u.rol_id)?.nombre || "" }))));
  app.get("/api/metas/fuentes", requiereLogin, admin, (req, res) => res.json(FUENTES.map((clave) => ({ clave, descripcion: DESCRIPCION_FUENTES[clave] }))));
```

  - **Ojo con el orden de las rutas:** `/api/metas/personas-corporativo` y `/api/metas/fuentes` van **antes** de
    `app.get("/api/metas/:clave/historial")`. No chocan porque esa ruta lleva `/historial`, pero se registran arriba
    del bloque de `/:clave`, para que nadie lo dude.
  - **En `capturaEnAlcance`:** una captura con `sucursal_id: null` (corporativa sin tienda) solo está en alcance para
    `verTodas`. La condición actual `captura.sucursal_id === sucursalId` ya da `false` con `null`, así que no hay que
    cambiar código; se agrega el comentario.
  - **En `server.js`**, después de crear la bandeja:

```js
require("./metasFuentes").configurarFuentes({ sqlite: bandejaDisponible() ? conexionSqlite : null });
```

  - Sin bandeja, `sicar_estados_historial` deja de contarse. Es aceptable: esa tabla vive en la misma conexión, y si
    no hay conexión tampoco hay SICAR.

- [ ] **Step 4: Run** el archivo nuevo, `metasRutas.test.js` y la suite completa. Expected: 0 fallas.
- [ ] **Step 5: Commit** `feat(metas): rutas del corporativo, revisada y fuentes conectadas`.

---

## Task 6: Pantallas de F1

**Files:**
- Modify:
  - `src/metas/pestanasObjetivos.js`
  - `src/GerenciaVentas.jsx` (cálculo de pestañas y aviso ámbar)
  - `src/metas/AdministrarMetas.jsx` ("¿Para quién?" y "¿Cómo se cuenta?")
  - `src/metas/MisMetas.jsx`
  - `src/metas/TableroMetas.jsx`
  - la pantalla de revisión (botón "Revisada" junto a "Anular": localizar con
    `grep -n "anular" src/metas/*.jsx`)
- Test: `src/metas/pestanasObjetivos.test.js` (agregar) y las pruebas de render existentes de metas

**Interfaces:**
- Consume: las rutas de Task 5.
- Produce: `pestanasObjetivos({ miVendedorId, veTienda, permisos, sinVendedor })`.

- [ ] **Step 1: Failing test** en `pestanasObjetivos.test.js`:

```js
test("cuenta sin vendedor con usar_gerente_ventas ve solo Mis metas extra en Lo mio", () => {
  const p = pestanasObjetivos({ miVendedorId: null, sinVendedor: true, permisos: ["usar_gerente_ventas"] });
  assert.deepEqual(p.filter((x) => x.grupo === "mio").map((x) => x.clave), ["mis-metas"]);
});
```

- [ ] **Step 2: Run to fail:** `node --test src/metas/pestanasObjetivos.test.js` desde la raíz del worktree.
- [ ] **Step 3: Implement.**
  - **`pestanasObjetivos`:** cuando `miVendedorId == null && sinVendedor && permisos.includes("usar_gerente_ventas")`,
    agrega solo `{ clave: "mis-metas", ... grupo: "mio" }`.
  - **`GerenciaVentas.jsx`:** pasa `sinVendedor: miVendedorId == null`. El aviso ámbar "Tu cuenta no tiene un
    vendedor ligado…" (`GerenciaVentas.jsx:315-319`) se muestra solo si la cuenta tampoco tiene la pestaña "mis-metas".
  - **`AdministrarMetas.jsx`:**
    - opción "Persona del corporativo" en "¿Para quién?";
    - al elegirla, carga `GET /api/metas/personas-corporativo` y muestra un `<select>` con "nombre — rol", más un
      `<select>` de tienda opcional ("Toda la empresa" = vacío);
    - selector "¿Cómo se cuenta?" con `GET /api/metas/fuentes`;
    - si la fuente no es manual, se oculta "Prueba" y se manda `prueba: "ninguna"`;
    - el cuerpo manda `alcance: "corporativo", usuario_id, sucursal_id, fuente`;
    - los `className` largos van a constantes, por la regla de 200 caracteres.
  - **`MisMetas.jsx`:**
    - si `meta.fuente !== "manual"`, en vez del botón "Hecho" muestra "Se cuenta sola" y una lista plegable con
      `meta.detalle` (fecha y texto);
    - si `meta.aviso`, muestra el aviso en ámbar.
  - **`TableroMetas.jsx`:**
    - el filtro de persona agrega un `<optgroup label="Corporativo">` con `personas-corporativo`, solo si tiene
      `administrar_metas_personalizadas`;
    - al elegir, manda `usuario_id`;
    - el desglose muestra la fuente.
  - **Revisión:** botón "Revisada" que llama `POST /api/metas/captura/:id/revisada` y refresca la lista. Si
    `captura.revisada`, se muestra "Revisada por X".
- [ ] **Step 4: Run** las pruebas de `src/metas/*.test.js`, `npx eslint src backend` (0 errores) y `npx vite build`.
- [ ] **Step 5: Commit** `feat(metas): pantallas de metas del corporativo`.

---

## Task 7: Núcleo de la visita del supervisor (`backend/supervision.js`)

**Files:**
- Create: `backend/supervision.js`
- Modify:
  - `backend/permisosCatalogo.js`: módulo `{ id: "supervision", nombre: "Supervisión de tiendas" }` y los 4 permisos
    `realizar_visitas_tienda`, `administrar_checklist_visitas`, `atender_fallas_visita` y `ver_supervision`, con
    `modulo: "supervision", implementado: true`;
  - `backend/server.js`: semilla `supervision: { checklist: [], visitas: [], fallas: [], encargado_sugerido: {} }`
    dentro de `const DB = {`, y `asegurarChecklistInicial(DB)` al arrancar, después de restaurar.
- Test: `backend/supervision.test.js`

**Interfaces:**
- Produce (todas lanzan `Error` con mensaje en español; las de alcance llevan `status: 404`):
  - `CHECKLIST_INICIAL`, `DIAS_FALLA = 7`;
  - `asegurarChecklistInicial(DB)`: siembra una sola vez, si `checklist` está vacío;
  - `editarChecklist(DB, {accion: "agregar"|"desactivar"|"reactivar", id?, seccion?, texto?, motivo}, usuario)`;
  - `iniciarVisita(DB, {sucursal_id, lat, lng}, usuario, ahora)` devuelve la visita;
  - `marcarPunto(DB, visitaId, {checklist_id, resultado, nota?, responsable_id?, pasos?}, usuario, foto?)`. `foto` es
    `{drive_id, nombre, huella}`, ya subida por la ruta;
  - `terminarVisita(DB, visitaId, usuario, ahora)` devuelve `{visita, fallas}`;
  - `marcarPaso(DB, fallaId, indice, usuario)`;
  - `resolverFalla(DB, fallaId, {nota}, usuario, foto)`;
  - `reasignarFalla(DB, fallaId, {responsable_id, motivo}, usuario)`;
  - `cancelarFalla(DB, fallaId, {motivo}, usuario)`;
  - `fallaAtrasada(falla, hoy)` devuelve un booleano.

- [ ] **Step 1: Failing tests** (todos sobre una `DB` local con `pos.sucursales` `[{id:1, lat:16.9, lng:-92.1}, {id:2, lat:null, lng:null}]`,
  `admin.usuarios` `[{id:80, nombre:"Sup", activo:true, sucursal_id:1}, {id:90, nombre:"Encargada", activo:true, sucursal_id:1},
  {id:91, nombre:"Otra tienda", activo:true, sucursal_id:2}]` y `supervision` vacío):

```js
test("checklist inicial: 15 puntos en 3 secciones, siembra una vez", () => {
  const DB = prepararDB();
  asegurarChecklistInicial(DB); asegurarChecklistInicial(DB);
  assert.equal(DB.supervision.checklist.length, 15);
  assert.deepEqual([...new Set(DB.supervision.checklist.map((p) => p.seccion))], ["imagen", "sistemas", "funcionamiento"]);
});

test("visita: dentro de 300 m comprobada; lejos o tienda sin coordenadas no comprobada", () => {
  const DB = prepararDB(); asegurarChecklistInicial(DB);
  assert.equal(iniciarVisita(DB, { sucursal_id: 1, lat: 16.9005, lng: -92.1 }, SUP, AHORA).ubicacion.comprobada, true);
  assert.equal(iniciarVisita(DB, { sucursal_id: 1, lat: 16.95, lng: -92.1 }, { id: 81, nombre: "Sup2" }, AHORA).ubicacion.comprobada, false);
  assert.equal(iniciarVisita(DB, { sucursal_id: 2, lat: 16.9, lng: -92.1 }, SUP, AHORA).ubicacion.comprobada, false);
});

test("visita: una en curso por supervisor y tienda; sin lat/lng validos se rechaza", () => {
  const DB = prepararDB(); asegurarChecklistInicial(DB);
  iniciarVisita(DB, { sucursal_id: 1, lat: 16.9, lng: -92.1 }, SUP, AHORA);
  assert.throws(() => iniciarVisita(DB, { sucursal_id: 1, lat: 16.9, lng: -92.1 }, SUP, AHORA), /en curso/);
  assert.throws(() => iniciarVisita(DB, { sucursal_id: 1, lat: "x", lng: -92.1 }, { id: 81 }, AHORA), /ubicación/);
});

test("falla exige nota, foto, responsable de esa tienda y al menos un paso", () => {
  const DB = prepararDB(); asegurarChecklistInicial(DB);
  const v = iniciarVisita(DB, { sucursal_id: 1, lat: 16.9, lng: -92.1 }, SUP, AHORA);
  const punto = DB.supervision.checklist[0].id;
  const foto = { drive_id: "d1", nombre: "f.jpg", huella: "h1" };
  assert.throws(() => marcarPunto(DB, v.id, { checklist_id: punto, resultado: "falla", nota: "Sucio", responsable_id: 90, pasos: ["Barrer"] }, SUP, null), /foto/);
  assert.throws(() => marcarPunto(DB, v.id, { checklist_id: punto, resultado: "falla", nota: "", responsable_id: 90, pasos: ["Barrer"] }, SUP, foto), /nota/);
  assert.throws(() => marcarPunto(DB, v.id, { checklist_id: punto, resultado: "falla", nota: "Sucio", responsable_id: 91, pasos: ["Barrer"] }, SUP, foto),
    /de esta tienda/);
  assert.throws(() => marcarPunto(DB, v.id, { checklist_id: punto, resultado: "falla", nota: "Sucio", responsable_id: 90, pasos: [] }, SUP, foto), /paso/);
  marcarPunto(DB, v.id, { checklist_id: punto, resultado: "falla", nota: "Sucio", responsable_id: "90", pasos: ["Barrer", "Trapear"] }, SUP, foto);
  assert.equal(DB.supervision.encargado_sugerido[1], 90);
});

test("terminar exige todos los puntos activos y crea fallas con limite a 7 dias", () => {
  const DB = prepararDB(); asegurarChecklistInicial(DB);
  const v = iniciarVisita(DB, { sucursal_id: 1, lat: 16.9, lng: -92.1 }, SUP, AHORA);
  assert.throws(() => terminarVisita(DB, v.id, SUP, AHORA), /faltan/i);
  const [primero, ...resto] = DB.supervision.checklist;
  marcarPunto(DB, v.id, { checklist_id: primero.id, resultado: "falla", nota: "Sucio", responsable_id: 90, pasos: ["Barrer"] }, SUP,
    { drive_id: "d1", nombre: "f.jpg", huella: "h1" });
  for (const p of resto) marcarPunto(DB, v.id, { checklist_id: p.id, resultado: "bien" }, SUP, null);
  const { visita, fallas } = terminarVisita(DB, v.id, SUP, AHORA);
  assert.equal(visita.estado, "terminada");
  assert.equal(fallas.length, 1);
  assert.equal(fallas[0].limite, "2026-09-17");
  assert.throws(() => marcarPunto(DB, v.id, { checklist_id: primero.id, resultado: "bien" }, SUP, null), /terminada/);
});

test("solo el responsable resuelve, con foto; reasignar y cancelar piden motivo; atrasada al octavo dia", () => {
  const DB = prepararDB(); const falla = fallaDePrueba(DB); // helper local que corre los pasos del test anterior
  const foto = { drive_id: "d2", nombre: "r.jpg", huella: "h2" };
  assert.throws(() => resolverFalla(DB, falla.id, { nota: "Listo" }, { id: 91, nombre: "X" }, foto), /responsable/);
  assert.throws(() => resolverFalla(DB, falla.id, { nota: "Listo" }, { id: 90, nombre: "Encargada" }, null), /foto/);
  assert.throws(() => reasignarFalla(DB, falla.id, { responsable_id: 90, motivo: "" }, SUP), /motivo/);
  assert.equal(fallaAtrasada(falla, "2026-09-17"), false);
  assert.equal(fallaAtrasada(falla, "2026-09-18"), true);
  marcarPaso(DB, falla.id, 0, { id: 90, nombre: "Encargada" });
  const r = resolverFalla(DB, falla.id, { nota: "Listo" }, { id: 90, nombre: "Encargada" }, foto);
  assert.equal(r.estado, "resuelta");
  assert.deepEqual(r.historial.map((h) => h.accion), ["abierta", "paso", "resuelta"]);
  assert.equal(fallaAtrasada(r, "2026-12-01"), false);
});
```

  `AHORA = "2026-09-10T16:00:00.000Z"` (día de tienda 2026-09-10) y `SUP = { id: 80, nombre: "Sup" }`.

- [ ] **Step 2: Run to fail.**
- [ ] **Step 3: Implement** `backend/supervision.js` con estas piezas:
  - **Requires:** `distanciaMetros` de `./auth`, `fechaLocal` de `./fechas`.
  - **Radio:** `RADIO_METROS = 300`. Si `auth.js` no exporta `RADIO_TOLERANCIA_METROS`, se agrega a su
    `module.exports` y se usa ese.
  - **`CHECKLIST_INICIAL`:** los 15 textos del spec §5.2 con su sección. `asegurarChecklistInicial` los convierte en
    `{id, seccion, texto, activo: true, orden}`.
  - **Ubicación:** `ubicacionDe(sucursal, lat, lng)`.
    - Lanza "La ubicación no es válida" si `lat` o `lng` no son finitos.
    - Si la tienda no tiene coordenadas finitas, devuelve `{lat, lng, distancia_m: null, comprobada: false}`.
    - Si las tiene, `comprobada` es `distancia <= RADIO_METROS`.
  - **`iniciarVisita`:**
    - valida la tienda;
    - rechaza si ya hay una visita en curso de ese supervisor en esa tienda;
    - guarda `mes: fechaLocal(new Date(ahora)).slice(0, 7)`, `puntos: []`, `estado: "en_curso"` e
      `iniciada_en: ahora`.
  - **`marcarPunto`:**
    - la visita debe existir, ser del mismo supervisor (si no, 404) y estar `en_curso` (si no, "La visita ya está
      terminada");
    - el punto debe estar activo;
    - `resultado` debe estar en `["bien", "falla", "no_aplica"]`;
    - **si es falla:**
      - `nota` de 1 a 300 caracteres, recortada;
      - `foto` obligatoria;
      - responsable: cuenta activa con `sucursal_id === visita.sucursal_id` (si no, "El responsable debe ser de esta
        tienda");
      - `pasos`: arreglo de 1 a 10 textos de 1 a 200 caracteres;
      - guarda `encargado_sugerido[sucursal] = responsable`;
    - reemplaza el punto si ya estaba marcado.
  - **`terminarVisita`:**
    - "Faltan N puntos por revisar" si alguno activo no está marcado;
    - crea una falla por cada punto con falla:
      `limite = fechaLocal(new Date(Date.parse(ahora) + DIAS_FALLA * 86400000))`,
      `historial: [{accion: "abierta", ...}]`, `pasos: textos.map((texto) => ({texto, hecho_en: null, hecho_por_id: null}))`.
  - **`marcarPaso` / `resolverFalla`:**
    - solo `falla.responsable_id === usuario.id` (si no, "Solo el responsable puede ...");
    - la falla debe estar abierta;
    - `resolverFalla` exige foto y nota;
    - cada uno agrega su renglón al historial.
  - **`reasignarFalla` / `cancelarFalla`:**
    - motivo obligatorio (`motivoObligatorio` de `./metasPersonalizadas`);
    - reasignar valida que el nuevo responsable sea de la tienda.
  - **`fallaAtrasada`:** `falla.estado === "abierta" && hoy > falla.limite`.
  - **Ids:** `siguienteId` como en los demás módulos.
- [ ] **Step 4: Run** `supervision.test.js` y la suite completa. El guard de permisos no debe tumbar el arranque:
  `node --test arranquePersistencia.test.js`.
- [ ] **Step 5: Commit** `feat(supervision): visita mensual con checklist, gps y fallas con paso a paso`.

---

## Task 8: Rutas de supervisión, con fotos a Drive

**Files:**
- Create: `backend/supervisionRutas.js`
- Modify: `backend/server.js` (registrar las rutas junto a `require("./metasRutas")`, con las mismas deps más
  `drive` y `guardar`)
- Test: `backend/supervisionRutas.test.js`

**Interfaces:**
- Consume: Task 7 y `prepararEvidencia` de `./objetivosActividades`.
- Produce (todas con `requiereLogin`):
  - `GET /api/supervision/checklist` (`realizar_visitas_tienda` o `administrar_checklist_visitas`);
  - `POST /api/supervision/checklist` (`administrar_checklist_visitas`);
  - `POST /api/supervision/visitas` con `{sucursal_id, lat, lng}` (`realizar_visitas_tienda`). Si la tienda está
    fuera del alcance del token, 404;
  - `POST /api/supervision/visitas/:id/puntos` con `{checklist_id, resultado, nota, responsable_id, pasos, archivo}`;
  - `POST /api/supervision/visitas/:id/terminar`;
  - `GET /api/supervision/visitas?mes=AAAA-MM` (`ver_supervision`, filtrado por alcance), más las del propio
    supervisor;
  - `GET /api/supervision/mis-fallas` (`atender_fallas_visita`): las del usuario del token, con `atrasada`;
  - `GET /api/supervision/fallas?estado=` (`ver_supervision`, por alcance), con `atrasada`;
  - `POST /api/supervision/fallas/:id/pasos/:indice` y `POST /api/supervision/fallas/:id/resolver` (con `archivo`),
    con `atender_fallas_visita`;
  - `POST /api/supervision/fallas/:id/reasignar` y `POST /api/supervision/fallas/:id/cancelar`
    (`realizar_visitas_tienda` o `ver_supervision`, con alcance);
  - `GET /api/supervision/responsables?sucursal_id=`: las cuentas activas de esa tienda y el sugerido.

- [ ] **Step 1: Failing tests** (molde de `metasRutas.test.js`, con `drive.asegurarCarpetaActividadesSucursal` y
  `drive.subirArchivoADrive` falsos). Casos:
  1. Supervisor global inicia una visita y recibe 200.
  2. Una cuenta sin `realizar_visitas_tienda` recibe 403.
  3. Un supervisor amarrado a la tienda 2 pide la tienda 1 y recibe 404.
  4. Marcar falla con `archivo` válido llama a Drive una vez y guarda `foto.drive_id`. **No se escribe ningún archivo
     en disco:** el directorio temporal de `DB_PATH` no gana archivos, salvo los del propio SQLite.
  5. Falla con `archivo` PNG de firma falsa recibe 400 "El archivo no es una foto JPG o PNG válida", y Drive no se
     llama.
  6. Terminar, ver `mis-fallas` como encargada, resolver con foto y recibir 200. Otra cuenta resolviendo recibe 400.
  7. `GET /api/supervision/fallas` de un gerente de la tienda 2 no trae las de la tienda 1.
  8. Reiniciar el estado (`restaurarEstado`) conserva `DB.supervision`. Se cubre con un `guardar` + cargar o con la
     prueba de `restaurarEstado` existente; se agrega `supervision` a su caso de claves si aplica.
- [ ] **Step 2: Run to fail.**
- [ ] **Step 3: Implement.** Mismo estilo que `metasRutas.js`:
  - `responder` mapea `status` 404 y 403, y todo lo demás a 400;
  - `guardar(DB)` después de cada escritura exitosa;
  - foto: `const { evidencia, buffer } = prepararEvidencia({ evidencia: "foto" }, { archivo })`, luego
    `carpeta = await drive.asegurarCarpetaActividadesSucursal(DB, sucursal)` y
    `subido = await drive.subirArchivoADrive(DB, { nombre: \`Supervision ${mes} - ${sucursal.nombre} - ${evidencia.nombre_archivo}\`, mimeType, contenidoBuffer: buffer, carpetaId: carpeta })`;
  - si la lógica falla después de subir, borrar con `drive.eliminarArchivoDeDrive`, como `metasCapturas.borrarFoto`;
  - alcance con `resolverAlcanceAutorizado(req)`: `verTodas || sucursal === sucursalId`.
- [ ] **Step 4: Run** la prueba nueva y la suite completa.
- [ ] **Step 5: Commit** `feat(supervision): rutas de visitas y fallas con fotos a Drive`.

---

## Task 9: Pantallas de supervisión

**Files:**
- Create:
  - `src/supervision/Supervision.jsx` (contenedor con pestañas según permisos)
  - `src/supervision/VisitaTienda.jsx`
  - `src/supervision/PendientesTienda.jsx`
  - `src/supervision/ResumenSupervision.jsx`
  - `src/supervision/EditorChecklist.jsx`
  - `src/supervision/pestanasSupervision.js` (+ `.test.js`)
- Modify:
  - `src/menuCategorias.js`: en el grupo "ADMINISTRACIÓN", `{ id: "supervision", nombre: "Supervisión", modulo: "supervision", permiso: ["realizar_visitas_tienda", "administrar_checklist_visitas", "atender_fallas_visita", "ver_supervision"] }`
  - `src/App.jsx`: `"supervision"` en `MODULOS` y `{vista === "supervision" && <Supervision permisos={usuario.permisos} usuario={usuario} />}`

**Interfaces:**
- Consume: las rutas de Task 8.
- Produce: `pestanasSupervision(permisos)`, que devuelve `[{clave, etiqueta}]` con las claves `visita`, `pendientes`,
  `resumen` y `checklist`.

- [ ] **Step 1: Failing test** `pestanasSupervision.test.js`:

```js
test("cada permiso abre su pestana", () => {
  assert.deepEqual(pestanasSupervision(["atender_fallas_visita"]).map((p) => p.clave), ["pendientes"]);
  assert.deepEqual(pestanasSupervision(["realizar_visitas_tienda", "ver_supervision"]).map((p) => p.clave), ["visita", "resumen"]);
  assert.deepEqual(pestanasSupervision(["administrar_checklist_visitas"]).map((p) => p.clave), ["checklist"]);
});
```

- [ ] **Step 2: Run to fail.** `node --test src/supervision/pestanasSupervision.test.js`
- [ ] **Step 3: Implement.**
  - **`VisitaTienda`, pensada para 390 px:**
    - `<select>` de tienda;
    - botón "Llegué a la tienda", que pide `navigator.geolocation.getCurrentPosition` (con timeout de 10 s) y hace
      `POST /visitas`;
    - si `!ubicacion.comprobada`, banner ámbar: "La ubicación no se pudo comprobar; esta visita no contará para la
      meta";
    - tres secciones plegables con cada punto y tres botones grandes: Bien, Falla y N/A;
    - **Falla** abre un panel con nota, `<input type="file" accept="image/*" capture="environment">` (convertido a
      base64 como en `MisMetas.jsx`), `<select>` del responsable con el sugerido preseleccionado y la lista de pasos
      (agregar o quitar renglones). Su botón "Guardar falla" es `type="button"`;
    - "Terminar visita" deshabilitado mientras falten puntos, con el conteo "Faltan N".
  - **`PendientesTienda`:**
    - tarjetas de `mis-fallas` con la foto (liga de Drive), la nota, la casilla de cada paso y "Resolver";
    - "Resolver" pide nota y foto;
    - las atrasadas van en rojo, con "venció el ...".
  - **`ResumenSupervision`:**
    - tabla de tiendas por mes (Hecha, En curso o Falta, y "No comprobada");
    - lista de fallas abiertas y atrasadas, con reasignar o cancelar con motivo;
    - historial plegable.
  - **`EditorChecklist`:** lista por sección, con agregar, desactivar y reactivar, siempre con motivo.
  - Los `className` largos van a constantes. Ningún modal sin scroll: usar el patrón existente con `max-h` y
    `overflow-y-auto`.
- [ ] **Step 4: Run** las pruebas de `src`, `npx eslint src backend` (0 errores) y `npx vite build`.
- [ ] **Step 5: Commit** `feat(supervision): pantallas de visita, pendientes, resumen y checklist`.

---

## Task 10: Verificación completa y prueba en navegador

**Files:** ninguno nuevo, salvo las correcciones que salgan.

- [ ] **Step 1:** suite completa del backend (0 fallas), pruebas de `src`, eslint con 0 errores, `vite build` y
  `grep -n "if (false" backend/*.js` vacío.
- [ ] **Step 2:** levantar el backend (`node server.js`, en el `DB_PATH` temporal) y vite. Crear los roles de prueba
  en localhost:
  - Supervisor: `usar_gerente_ventas`, `realizar_visitas_tienda`, `ver_supervision`, con alcance global;
  - Gerente de compras: `usar_gerente_ventas`, `ver_radar_demanda` y el permiso de seguimiento del Radar;
  - Encargada de la tienda 1: `atender_fallas_visita`.

  Las credenciales de prueba se crean en esta sesión y solo en localhost.
- [ ] **Step 3, recorrido con Claude in Chrome:**
  1. El admin crea una meta "Seguimiento de demanda" para el gerente de compras, con fuente `radar_seguimiento_a_tiempo`.
  2. El gerente da seguimiento a una demanda nueva y ve su avance en 1, con el detalle.
  3. El admin crea una meta corporativa manual para el supervisor, y el supervisor la marca "Hecho".
  4. El supervisor, a 390 px, hace la visita con una falla y su foto. La ubicación se simula con la
     geolocalización emulada.
  5. La encargada ve la falla, marca el paso y la resuelve.
  6. El admin la ve resuelta en Supervisión.
  7. Una cuenta sin permiso no ve el menú.
- [ ] **Step 4:** apagar el backend y vite (equipo de 8 GB).
- [ ] **Step 5:** revisión independiente con un agente Code Reviewer sobre `aca6e03..HEAD`. Corregir sus hallazgos
  con prueba roja primero, y commitear.
- [ ] **Step 6:** informe a Victor. Le toca a él el merge y el push.
