# Metas personalizadas: servidor — Implementation Plan (Entrega 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Servidor completo de metas personalizadas (OKRs y metas manuales por tienda, persona o empresa; periodos semanal/mensual/trimestral; captura "Hecho" con liga, foto o cantidad; anular; sellar y rectificar; tablero con privacidad).

**Architecture:** Familia nueva e independiente de los tipos fijos de Objetivos. Cinco módulos puros en `backend/` (periodos, definiciones, capturas, avance, sellos) y un módulo de rutas `backend/metasRutas.js` que `server.js` registra con sus dependencias. Datos en 4 colecciones nuevas de `DB.pos`, persistidas por el mecanismo existente (JSON en SQLite).

**Tech Stack:** Node/Express (CommonJS), `node:test`, `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-10-08-metas-personalizadas-design.md`

## Global Constraints

- Rama `feature/metas-personalizadas`, worktree `C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/metas-personalizadas`. Esta entrega va DESPUÉS de la Entrega 0.5 (eliminar metas fijas).
- Solo el administrador crea/edita/retira metas y OKRs, sella y rectifica (`administrar_metas_personalizadas`).
- Eliminar = retirar con motivo; nunca borrar registros. Motivo obligatorio (no vacío tras `trim()`) en toda edición, retiro, anulación y rectificación.
- Periodo sellado: nada cambia (metas, OKRs, capturas, anulaciones); solo rectificar el resultado, nunca la cifra meta.
- Liga normalizada con `normalizarLink` de `backend/objetivosActividades.js`; no se acepta repetida en ninguna captura vigente de metas ni en actividades vigentes.
- Fotos a Drive con el mismo flujo que actividades; nunca al disco de Render; nunca exponer `drive_file_id` en respuestas.
- Fechas en hora de Chiapas (`fechaLocal` de `backend/fechas.js`); no se captura en fecha futura ni fuera del periodo.
- Nadie captura a nombre de otro: el vendedor sale SIEMPRE de la cuenta (`vendedorLigadoAObjetivos`), nunca del cuerpo.
- Ninguna dependencia nueva. Acentos sí en código y mensajes; commits SIN acentos.
- Pruebas: `node --preserve-symlinks --preserve-symlinks-main --test <archivo>` desde `backend/`. Claude corre la suite completa y commitea.

## Concreciones del spec (decididas al planear; el spec se actualiza en el mismo commit que este plan)

- Cada OKR y cada meta tienen `clave` estable (el `id` de su versión 1); cada versión tiene su propio `id`. Las capturas apuntan a `meta_clave`.
- El sello es por `periodo` + `inicio` y cubre TODAS las tiendas (lo sella el admin, que ve todo).
- Privacidad en metas compartidas (tienda/empresa): son conteos, no dinero; quien no es jefatura ve cifra meta, total y %, y SOLO sus propias capturas; nunca el desglose por persona ni capturas ajenas. Jefatura ve desglose por persona.
- Retirar un OKR retira también sus metas vigentes con el mismo motivo.
- Editables de una meta: nombre, descripción, unidad, prueba, valor_meta. Cambiar periodo, inicio o alcance = retirar y crear otra.

## Review Focus

1. Liga del mismo video con `?utm_source=...`, `www.`, `m.` o `/` final: rechazada como repetida (incluso si ya se usó en una actividad de grupos/Marketplace).
2. Captura de meta de tienda por alguien que ese día no está en la plantilla de esa tienda (traslado a mitad de mes): rechazada con el mensaje de `validarFechaYPlantilla`.
3. Periodo que ya terminó pero no está sellado: se puede capturar con fecha dentro del periodo; no se puede sellar uno que no ha terminado.
4. Vendedora pide el tablero: no recibe `por_persona` ni capturas de otros en metas de tienda/empresa.
5. El periodo se sella mientras sube una foto: la captura se rechaza después de Drive (`antesDeGuardar`), sin quedar a medias.

---

### Task 1: periodos

**Files:**
- Create: `backend/metasPeriodos.js`
- Test: `backend/metasPeriodos.test.js`

**Interfaces:**
- Produces: `PERIODOS`, `validarPeriodo(periodo, inicio)` (lanza), `finDePeriodo(periodo, inicio) -> "AAAA-MM-DD"`, `inicioDePeriodo(periodo, fecha) -> "AAAA-MM-DD"`, `ritmoEsperado(periodo, inicio, hoy) -> número 0..1`.

- [ ] **Step 1: Pruebas que fallan**

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validarPeriodo, finDePeriodo, inicioDePeriodo, ritmoEsperado } = require("./metasPeriodos");

test("la semana va de lunes a domingo", () => {
  assert.equal(finDePeriodo("semanal", "2026-10-05"), "2026-10-11");
  assert.equal(inicioDePeriodo("semanal", "2026-10-11"), "2026-10-05");
  assert.equal(inicioDePeriodo("semanal", "2026-10-05"), "2026-10-05");
  assert.throws(() => validarPeriodo("semanal", "2026-10-06"), /lunes/);
});

test("mes y trimestre de calendario, incluido febrero bisiesto y fin de año", () => {
  assert.equal(finDePeriodo("mensual", "2028-02-01"), "2028-02-29");
  assert.equal(finDePeriodo("trimestral", "2026-10-01"), "2026-12-31");
  assert.equal(inicioDePeriodo("trimestral", "2026-08-15"), "2026-07-01");
  assert.equal(inicioDePeriodo("mensual", "2026-08-15"), "2026-08-01");
  assert.throws(() => validarPeriodo("mensual", "2026-10-02"), /día 1/);
  assert.throws(() => validarPeriodo("trimestral", "2026-02-01"), /enero, abril, julio u octubre/);
});

test("periodo o fecha inválidos se rechazan", () => {
  assert.throws(() => validarPeriodo("anual", "2026-01-01"), /semanal, mensual o trimestral/);
  assert.throws(() => validarPeriodo("mensual", "2026-02-30"), /fecha/);
  assert.throws(() => validarPeriodo("mensual", 20261001), /fecha/);
});

test("ritmo esperado: 0 antes, proporcional durante, 1 al terminar", () => {
  assert.equal(ritmoEsperado("semanal", "2026-10-05", "2026-10-04"), 0);
  assert.equal(ritmoEsperado("semanal", "2026-10-05", "2026-10-05"), 1 / 7);
  assert.equal(ritmoEsperado("semanal", "2026-10-05", "2026-10-11"), 1);
  assert.equal(ritmoEsperado("semanal", "2026-10-05", "2026-11-01"), 1);
});
```

- [ ] **Step 2:** `node --preserve-symlinks --preserve-symlinks-main --test metasPeriodos.test.js` → FAIL (`Cannot find module './metasPeriodos'`).

- [ ] **Step 3: Implementar** `backend/metasPeriodos.js`

```js
// Periodos de las metas personalizadas (decisión de Victor 2026-10-08): semana de lunes a domingo,
// mes y trimestre de calendario. Todo en texto AAAA-MM-DD; la aritmética en UTC para no depender
// de la zona del servidor (Render corre en UTC; las tiendas en hora de Chiapas).
const { fechaValida } = require("./objetivosFechas");

const PERIODOS = ["semanal", "mensual", "trimestral"];
const DIA_MS = 24 * 60 * 60 * 1000;
const aUTC = (fecha) => { const [a, m, d] = fecha.split("-").map(Number); return new Date(Date.UTC(a, m - 1, d)); };
const aTexto = (fecha) => fecha.toISOString().slice(0, 10);

function validarPeriodo(periodo, inicio) {
  if (!PERIODOS.includes(periodo)) throw new Error("El periodo debe ser semanal, mensual o trimestral");
  if (!fechaValida(inicio)) throw new Error("El inicio debe ser una fecha AAAA-MM-DD válida");
  const dia = aUTC(inicio);
  if (periodo === "semanal" && dia.getUTCDay() !== 1) throw new Error("Una meta semanal empieza en lunes");
  if (periodo === "mensual" && dia.getUTCDate() !== 1) throw new Error("Una meta mensual empieza el día 1");
  if (periodo === "trimestral" && (dia.getUTCDate() !== 1 || dia.getUTCMonth() % 3 !== 0)) {
    throw new Error("Una meta trimestral empieza el 1 de enero, abril, julio u octubre");
  }
}

function finDePeriodo(periodo, inicio) {
  validarPeriodo(periodo, inicio);
  const dia = aUTC(inicio);
  if (periodo === "semanal") return aTexto(new Date(dia.getTime() + 6 * DIA_MS));
  const meses = periodo === "mensual" ? 1 : 3;
  return aTexto(new Date(Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth() + meses, 0)));
}

function inicioDePeriodo(periodo, fecha) {
  if (!PERIODOS.includes(periodo)) throw new Error("El periodo debe ser semanal, mensual o trimestral");
  if (!fechaValida(fecha)) throw new Error("La fecha debe ser AAAA-MM-DD válida");
  const dia = aUTC(fecha);
  if (periodo === "semanal") return aTexto(new Date(dia.getTime() - ((dia.getUTCDay() + 6) % 7) * DIA_MS));
  const mes = periodo === "mensual" ? dia.getUTCMonth() : dia.getUTCMonth() - (dia.getUTCMonth() % 3);
  return aTexto(new Date(Date.UTC(dia.getUTCFullYear(), mes, 1)));
}

function ritmoEsperado(periodo, inicio, hoy) {
  const fin = finDePeriodo(periodo, inicio);
  if (hoy < inicio) return 0;
  if (hoy >= fin) return 1;
  const total = (aUTC(fin) - aUTC(inicio)) / DIA_MS + 1;
  const transcurridos = (aUTC(hoy) - aUTC(inicio)) / DIA_MS + 1;
  return transcurridos / total;
}

module.exports = { PERIODOS, validarPeriodo, finDePeriodo, inicioDePeriodo, ritmoEsperado };
```

- [ ] **Step 4:** mismo comando → PASS.
- [ ] **Step 5: Commit** (Claude): `feat(metas): periodos semanal, mensual y trimestral`

---

### Task 2: colecciones y permisos

**Files:**
- Modify: `backend/server.js` (objeto `DB.pos` inicial, junto a `objetivo_creditos: []`, línea ~201)
- Modify: `backend/permisosCatalogo.js` (después de `resolver_diferencias_inventario`, línea ~95)
- Modify: `backend/roles.js` (`sembrarRolesIniciales`, filtro del Gerente, línea ~78)
- Test: `backend/metasPermisos.test.js` (nuevo)

**Interfaces:**
- Produces: `DB.pos.okrs`, `DB.pos.metas_personalizadas`, `DB.pos.meta_capturas`, `DB.pos.meta_sellos` (arreglos); permisos `administrar_metas_personalizadas`, `anular_capturas_metas`.

- [ ] **Step 1: Pruebas que fallan** (`backend/metasPermisos.test.js`)

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PERMISOS } = require("./permisosCatalogo");
const { sembrarRolesIniciales } = require("./roles");

test("los dos permisos nuevos existen en el módulo pos", () => {
  for (const clave of ["administrar_metas_personalizadas", "anular_capturas_metas"]) {
    const permiso = PERMISOS.find((p) => p.clave === clave);
    assert.ok(permiso, clave);
    assert.equal(permiso.modulo, "pos");
    assert.equal(permiso.implementado, true);
  }
});

test("administrar metas es solo del Administrador; anular capturas también del Gerente; el Cajero ninguno", () => {
  const DB = { admin: { roles: [] } };
  sembrarRolesIniciales(DB);
  const rol = (nombre) => DB.admin.roles.find((r) => r.nombre === nombre).permisos;
  assert.ok(rol("Administrador").includes("administrar_metas_personalizadas"));
  assert.ok(!rol("Gerente de sucursal").includes("administrar_metas_personalizadas"));
  assert.ok(rol("Gerente de sucursal").includes("anular_capturas_metas"));
  assert.ok(!rol("Cajero").includes("administrar_metas_personalizadas"));
  assert.ok(!rol("Cajero").includes("anular_capturas_metas"));
});
```

Verificar primero cómo se exporta `PERMISOS` en `permisosCatalogo.js` y cómo `crearRol` espera `DB` (ajustar el DB mínimo de la prueba a lo que `crearRol` necesite, p. ej. `DB.admin.roles` y un contador).

- [ ] **Step 2:** `node --preserve-symlinks --preserve-symlinks-main --test metasPermisos.test.js` → FAIL.

- [ ] **Step 3: Implementar**

`permisosCatalogo.js`, después de `resolver_diferencias_inventario`:

```js
  // Metas personalizadas (KPIs/OKRs). Crearlas es solo del Administrador (decisión de Victor 2026-10-08);
  // anular capturas ajenas es revisión de jefatura y queda a nombre de quien anula.
  { clave: "administrar_metas_personalizadas", etiqueta: "Crear y Sellar Metas Personalizadas (KPIs/OKRs)", modulo: "pos", implementado: true },
  { clave: "anular_capturas_metas", etiqueta: "Anular Capturas de Metas del Personal", modulo: "pos", implementado: true },
```

`roles.js`, en el filtro del Gerente, junto a `c !== "cerrar_mes_objetivos" &&`:

```js
      // Las metas personalizadas las crea y sella solo el Administrador (decision de Victor, 2026-10-08).
      c !== "administrar_metas_personalizadas" &&
```

`server.js`, en `DB.pos` inicial después de `objetivo_creditos: [],`:

```js
    // Metas personalizadas (KPIs/OKRs). Ver metasPersonalizadas.js.
    okrs: [],
    metas_personalizadas: [],
    meta_capturas: [],
    meta_sellos: [],
```

- [ ] **Step 4:** correr `metasPermisos.test.js` y además cualquier prueba existente que enumere el catálogo de permisos o los permisos del Gerente (buscar con `grep -l "cerrar_mes_objetivos" backend/*.test.js`). Si alguna prueba existente compara la lista EXACTA de permisos, se permite agregarle solo las dos claves nuevas. Expected: PASS.
- [ ] **Step 5: Commit** (Claude): `feat(metas): colecciones y permisos de metas personalizadas`

---

### Task 3: definiciones (OKRs y metas) con versiones y retiro

**Files:**
- Create: `backend/metasPersonalizadas.js`
- Test: `backend/metasPersonalizadas.test.js`

**Interfaces:**
- Consumes: `validarPeriodo` (Task 1).
- Produces: `periodoSellado(DB, periodo, inicio) -> bool`, `okrVigente(DB, clave)`, `metaVigente(DB, clave)`, `crearOkr(DB, datos, usuario)`, `editarOkr(DB, clave, datos, usuario)`, `retirarOkr(DB, clave, motivo, usuario)`, `crearMeta(DB, datos, usuario)`, `editarMeta(DB, clave, datos, usuario)`, `retirarMeta(DB, clave, motivo, usuario)`, `historial(DB, coleccion, clave)` donde `coleccion` es `"okrs"` o `"metas_personalizadas"`. `usuario = { id, nombre }`.
- Forma de una meta: `{ id, clave, version, vigente, retirada, reemplaza_a, motivo, okr_clave, nombre, descripcion, unidad, prueba, valor_meta, periodo, inicio, alcance, sucursal_id, vendedor_id, participantes, creado_por_id, creado_por, creado_en }`. OKR: igual sin `okr_clave, unidad, prueba, valor_meta`, con `titulo` en vez de `nombre`.

- [ ] **Step 1: Pruebas que fallan** (`backend/metasPersonalizadas.test.js`)

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("./metasPersonalizadas");

const VICTOR = { id: 1, nombre: "Victor" };
function DBPrueba() {
  return { pos: {
    sucursales: [{ id: 1, nombre: "Ocosingo" }, { id: 4, nombre: "Palenque" }],
    vendedores: [{ id: 1, nombre: "Ana", sucursal_id: 1 }, { id: 2, nombre: "Luis", sucursal_id: 4 }],
    okrs: [], metas_personalizadas: [], meta_capturas: [], meta_sellos: [],
  } };
}
const OKR = { titulo: "Videos Palenque", periodo: "mensual", inicio: "2026-10-01", alcance: "tienda", sucursal_id: 4 };
const META = { nombre: "Videos de tips", unidad: "videos", prueba: "liga", valor_meta: 12,
  periodo: "mensual", inicio: "2026-10-01", alcance: "tienda", sucursal_id: 4 };

test("crear meta suelta de tienda con auditoría", () => {
  const DB = DBPrueba();
  const meta = M.crearMeta(DB, META, VICTOR);
  assert.equal(meta.clave, meta.id);
  assert.equal(meta.version, 1);
  assert.equal(meta.vigente, true);
  assert.equal(meta.vendedor_id, null);
  assert.deepEqual(meta.participantes, []);
  assert.equal(meta.creado_por_id, 1);
  assert.equal(meta.creado_por, "Victor");
});

test("validaciones de la meta", () => {
  const DB = DBPrueba();
  assert.throws(() => M.crearMeta(DB, { ...META, nombre: "  " }, VICTOR), /nombre/);
  assert.throws(() => M.crearMeta(DB, { ...META, prueba: "video" }, VICTOR), /prueba/);
  assert.throws(() => M.crearMeta(DB, { ...META, valor_meta: 0 }, VICTOR), /cifra/);
  assert.throws(() => M.crearMeta(DB, { ...META, valor_meta: 2.5 }, VICTOR), /cifra/);
  assert.throws(() => M.crearMeta(DB, { ...META, sucursal_id: 99 }, VICTOR), /tienda/);
  assert.throws(() => M.crearMeta(DB, { ...META, inicio: "2026-10-02" }, VICTOR), /día 1/);
  assert.throws(() => M.crearMeta(DB, { ...META, alcance: "persona", vendedor_id: 99 }, VICTOR), /persona/);
  assert.throws(() => M.crearMeta(DB, { ...META, alcance: "empresa", participantes: [] }, VICTOR), /participantes/);
});

test("persona toma la tienda del vendedor; empresa no tiene tienda", () => {
  const DB = DBPrueba();
  const persona = M.crearMeta(DB, { ...META, alcance: "persona", vendedor_id: 2, sucursal_id: 1 }, VICTOR);
  assert.equal(persona.sucursal_id, 4);
  const empresa = M.crearMeta(DB, { ...META, alcance: "empresa", participantes: [2, 1, 2] }, VICTOR);
  assert.equal(empresa.sucursal_id, null);
  assert.deepEqual(empresa.participantes, [1, 2]);
});

test("la meta de un OKR hereda su periodo y alcance", () => {
  const DB = DBPrueba();
  const okr = M.crearOkr(DB, OKR, VICTOR);
  const meta = M.crearMeta(DB, { nombre: "Reseñas", unidad: "reseñas", prueba: "liga", valor_meta: 30, okr_clave: okr.clave }, VICTOR);
  assert.equal(meta.okr_clave, okr.clave);
  assert.equal(meta.periodo, "mensual");
  assert.equal(meta.sucursal_id, 4);
  assert.throws(() => M.crearMeta(DB, { ...META, okr_clave: 999 }, VICTOR), /OKR/);
});

test("editar crea versión nueva con motivo y conserva la clave", () => {
  const DB = DBPrueba();
  const v1 = M.crearMeta(DB, META, VICTOR);
  assert.throws(() => M.editarMeta(DB, v1.clave, { valor_meta: 15 }, VICTOR), /motivo/);
  const v2 = M.editarMeta(DB, v1.clave, { valor_meta: 15, motivo: "Más tiendas" }, VICTOR);
  assert.equal(v2.clave, v1.clave);
  assert.equal(v2.version, 2);
  assert.equal(v2.reemplaza_a, v1.id);
  assert.equal(v2.valor_meta, 15);
  assert.equal(v2.nombre, "Videos de tips");
  assert.equal(M.metaVigente(DB, v1.clave).id, v2.id);
  assert.deepEqual(M.historial(DB, "metas_personalizadas", v1.clave).map((m) => m.version), [1, 2]);
  assert.throws(() => M.editarMeta(DB, v1.clave, { periodo: "semanal", motivo: "x" }, VICTOR), /no se puede cambiar/);
});

test("retirar meta y retirar OKR con sus metas", () => {
  const DB = DBPrueba();
  const okr = M.crearOkr(DB, OKR, VICTOR);
  const meta = M.crearMeta(DB, { nombre: "Videos", unidad: "videos", prueba: "liga", valor_meta: 12, okr_clave: okr.clave }, VICTOR);
  assert.throws(() => M.retirarOkr(DB, okr.clave, " ", VICTOR), /motivo/);
  M.retirarOkr(DB, okr.clave, "Cambio de plan", VICTOR);
  assert.equal(M.okrVigente(DB, okr.clave), null);
  assert.equal(M.metaVigente(DB, meta.clave), null);
  const retirada = DB.pos.metas_personalizadas.find((m) => m.id === meta.id);
  assert.equal(retirada.retirada.motivo, "Cambio de plan");
  assert.equal(DB.pos.metas_personalizadas.length, 1);
  assert.throws(() => M.retirarMeta(DB, meta.clave, "otra", VICTOR), /no existe o fue eliminada/);
});

test("periodo sellado: no se crea, edita ni retira", () => {
  const DB = DBPrueba();
  const meta = M.crearMeta(DB, META, VICTOR);
  DB.pos.meta_sellos.push({ id: 1, periodo: "mensual", inicio: "2026-10-01" });
  assert.equal(M.periodoSellado(DB, "mensual", "2026-10-01"), true);
  assert.throws(() => M.crearMeta(DB, META, VICTOR), /sellado/);
  assert.throws(() => M.editarMeta(DB, meta.clave, { valor_meta: 3, motivo: "x" }, VICTOR), /sellado/);
  assert.throws(() => M.retirarMeta(DB, meta.clave, "x", VICTOR), /sellado/);
});
```

- [ ] **Step 2:** `node --preserve-symlinks --preserve-symlinks-main --test metasPersonalizadas.test.js` → FAIL (módulo no existe).

- [ ] **Step 3: Implementar** `backend/metasPersonalizadas.js`

```js
// Metas personalizadas: OKRs y metas que crea el Administrador (decisión de Victor 2026-10-08).
// Cada cambio es una versión nueva con motivo; eliminar es retirar, nunca borrar: una meta
// incumplida no puede desaparecer del historial.
const { validarPeriodo } = require("./metasPeriodos");

const ALCANCES = ["tienda", "persona", "empresa"];
const PRUEBAS = ["ninguna", "liga", "foto"];
const EDITABLES_META = ["nombre", "descripcion", "unidad", "prueba", "valor_meta"];
const EDITABLES_OKR = ["titulo", "descripcion"];

const siguienteId = (lista) => lista.reduce((maximo, r) => Math.max(maximo, r.id), 0) + 1;

function texto(valor, campo, maximo, { obligatorio = true } = {}) {
  if (valor === undefined || valor === null || (typeof valor === "string" && !valor.trim())) {
    if (obligatorio) throw new Error(`El campo ${campo} es obligatorio`);
    return null;
  }
  if (typeof valor !== "string") throw new Error(`El campo ${campo} debe ser texto`);
  const limpio = valor.trim();
  if (limpio.length > maximo) throw new Error(`El campo ${campo} no puede tener más de ${maximo} caracteres`);
  return limpio;
}

function motivoObligatorio(motivo, accion) {
  if (typeof motivo !== "string" || !motivo.trim()) throw new Error(`${accion} requiere un motivo; no puede estar vacío`);
  return motivo.trim();
}

function auditoria(usuario) {
  return { creado_por_id: usuario?.id ?? null, creado_por: usuario?.nombre || "desconocido", creado_en: new Date().toISOString() };
}

function periodoSellado(DB, periodo, inicio) {
  return (DB.pos.meta_sellos || []).some((s) => s.periodo === periodo && s.inicio === inicio);
}

function exigirAbierto(DB, periodo, inicio) {
  if (periodoSellado(DB, periodo, inicio)) throw new Error("El periodo ya está sellado; solo se puede rectificar el sello");
}

function validarAlcance(DB, { alcance, sucursal_id, vendedor_id, participantes }) {
  if (!ALCANCES.includes(alcance)) throw new Error("El alcance debe ser tienda, persona o empresa");
  if (alcance === "tienda") {
    const id = Number(sucursal_id);
    if (!DB.pos.sucursales.some((s) => s.id === id)) throw new Error("La tienda no existe");
    return { alcance, sucursal_id: id, vendedor_id: null, participantes: [] };
  }
  if (alcance === "persona") {
    const vendedor = DB.pos.vendedores.find((v) => v.id === Number(vendedor_id));
    if (!vendedor) throw new Error("La persona no existe");
    return { alcance, sucursal_id: vendedor.sucursal_id, vendedor_id: vendedor.id, participantes: [] };
  }
  const ids = Array.isArray(participantes) ? [...new Set(participantes.map(Number))].sort((a, b) => a - b) : [];
  if (!ids.length || ids.some((id) => !DB.pos.vendedores.some((v) => v.id === id))) {
    throw new Error("Una meta de empresa necesita participantes que existan");
  }
  return { alcance, sucursal_id: null, vendedor_id: null, participantes: ids };
}

function validarCifra(valor) {
  if (!Number.isInteger(valor) || valor < 1 || valor > 1000000) {
    throw new Error("La cifra meta debe ser un entero entre 1 y 1,000,000");
  }
  return valor;
}

function validarPrueba(prueba) {
  if (!PRUEBAS.includes(prueba)) throw new Error("La prueba debe ser ninguna, liga o foto");
  return prueba;
}

const vigenteDe = (lista, clave) => lista.find((r) => r.clave === Number(clave) && r.vigente) || null;
const okrVigente = (DB, clave) => vigenteDe(DB.pos.okrs, clave);
const metaVigente = (DB, clave) => vigenteDe(DB.pos.metas_personalizadas, clave);

function historial(DB, coleccion, clave) {
  return DB.pos[coleccion].filter((r) => r.clave === Number(clave)).sort((a, b) => a.version - b.version);
}

function nuevaVersion(lista, anterior, cambios, motivo, usuario) {
  const nuevo = { ...anterior, ...cambios, id: siguienteId(lista), version: anterior.version + 1, vigente: true,
    retirada: null, reemplaza_a: anterior.id, motivo, ...auditoria(usuario) };
  anterior.vigente = false;
  lista.push(nuevo);
  return nuevo;
}

function retirar(registro, motivo, usuario) {
  registro.vigente = false;
  registro.retirada = { por_id: usuario?.id ?? null, por_nombre: usuario?.nombre || "desconocido", en: new Date().toISOString(), motivo };
  return registro;
}

function crearOkr(DB, datos, usuario) {
  const titulo = texto(datos.titulo, "título", 120);
  const descripcion = texto(datos.descripcion, "descripción", 500, { obligatorio: false });
  validarPeriodo(datos.periodo, datos.inicio);
  exigirAbierto(DB, datos.periodo, datos.inicio);
  const alcance = validarAlcance(DB, datos);
  const id = siguienteId(DB.pos.okrs);
  const okr = { id, clave: id, version: 1, vigente: true, retirada: null, reemplaza_a: null, motivo: null,
    titulo, descripcion, periodo: datos.periodo, inicio: datos.inicio, ...alcance, ...auditoria(usuario) };
  DB.pos.okrs.push(okr);
  return okr;
}

function editarOkr(DB, clave, datos, usuario) {
  const anterior = okrVigente(DB, clave);
  if (!anterior) throw new Error("El OKR no existe o fue eliminado");
  exigirAbierto(DB, anterior.periodo, anterior.inicio);
  if (Object.keys(datos).some((k) => k !== "motivo" && !EDITABLES_OKR.includes(k))) {
    throw new Error("Del OKR solo se puede cambiar título y descripción; no se puede cambiar periodo ni alcance");
  }
  const motivo = motivoObligatorio(datos.motivo, "Cambiar un OKR");
  const cambios = {};
  if ("titulo" in datos) cambios.titulo = texto(datos.titulo, "título", 120);
  if ("descripcion" in datos) cambios.descripcion = texto(datos.descripcion, "descripción", 500, { obligatorio: false });
  return nuevaVersion(DB.pos.okrs, anterior, cambios, motivo, usuario);
}

function retirarOkr(DB, clave, motivo, usuario) {
  const okr = okrVigente(DB, clave);
  if (!okr) throw new Error("El OKR no existe o fue eliminado");
  exigirAbierto(DB, okr.periodo, okr.inicio);
  const limpio = motivoObligatorio(motivo, "Eliminar un OKR");
  for (const meta of DB.pos.metas_personalizadas.filter((m) => m.vigente && m.okr_clave === okr.clave)) {
    retirar(meta, limpio, usuario);
  }
  return retirar(okr, limpio, usuario);
}

function crearMeta(DB, datos, usuario) {
  const nombre = texto(datos.nombre, "nombre", 120);
  const descripcion = texto(datos.descripcion, "descripción", 500, { obligatorio: false });
  const unidad = texto(datos.unidad, "unidad", 40);
  const prueba = validarPrueba(datos.prueba);
  const valor_meta = validarCifra(datos.valor_meta);
  let base = datos;
  let okr_clave = null;
  if (datos.okr_clave !== undefined && datos.okr_clave !== null) {
    const okr = okrVigente(DB, datos.okr_clave);
    if (!okr) throw new Error("El OKR no existe o fue eliminado");
    okr_clave = okr.clave;
    base = okr;
  }
  validarPeriodo(base.periodo, base.inicio);
  exigirAbierto(DB, base.periodo, base.inicio);
  const alcance = validarAlcance(DB, base);
  const id = siguienteId(DB.pos.metas_personalizadas);
  const meta = { id, clave: id, version: 1, vigente: true, retirada: null, reemplaza_a: null, motivo: null,
    okr_clave, nombre, descripcion, unidad, prueba, valor_meta, periodo: base.periodo, inicio: base.inicio,
    ...alcance, ...auditoria(usuario) };
  DB.pos.metas_personalizadas.push(meta);
  return meta;
}

function editarMeta(DB, clave, datos, usuario) {
  const anterior = metaVigente(DB, clave);
  if (!anterior) throw new Error("La meta no existe o fue eliminada");
  exigirAbierto(DB, anterior.periodo, anterior.inicio);
  if (Object.keys(datos).some((k) => k !== "motivo" && !EDITABLES_META.includes(k))) {
    throw new Error("Periodo, inicio, alcance y OKR no se pueden cambiar: elimina la meta y crea otra");
  }
  const motivo = motivoObligatorio(datos.motivo, "Cambiar una meta");
  const cambios = {};
  if ("nombre" in datos) cambios.nombre = texto(datos.nombre, "nombre", 120);
  if ("descripcion" in datos) cambios.descripcion = texto(datos.descripcion, "descripción", 500, { obligatorio: false });
  if ("unidad" in datos) cambios.unidad = texto(datos.unidad, "unidad", 40);
  if ("prueba" in datos) cambios.prueba = validarPrueba(datos.prueba);
  if ("valor_meta" in datos) cambios.valor_meta = validarCifra(datos.valor_meta);
  return nuevaVersion(DB.pos.metas_personalizadas, anterior, cambios, motivo, usuario);
}

function retirarMeta(DB, clave, motivo, usuario) {
  const meta = metaVigente(DB, clave);
  if (!meta) throw new Error("La meta no existe o fue eliminada");
  exigirAbierto(DB, meta.periodo, meta.inicio);
  return retirar(meta, motivoObligatorio(motivo, "Eliminar una meta"), usuario);
}

module.exports = {
  ALCANCES, PRUEBAS, periodoSellado, okrVigente, metaVigente, historial,
  crearOkr, editarOkr, retirarOkr, crearMeta, editarMeta, retirarMeta, motivoObligatorio,
};
```

- [ ] **Step 4:** mismo comando → PASS.
- [ ] **Step 5: Commit** (Claude): `feat(metas): okrs y metas con versiones y retiro`

---

### Task 4: capturas ("Hecho") con liga, foto o cantidad, y anular

**Files:**
- Create: `backend/metasCapturas.js`
- Test: `backend/metasCapturas.test.js`

**Interfaces:**
- Consumes: `metaVigente`, `periodoSellado`, `motivoObligatorio` (Task 3); `finDePeriodo` (Task 1); `normalizarLink`, `prepararEvidencia`, `subidasEnCurso` de `objetivosActividades.js`; `validarFechaYPlantilla`, `fechaValida` de `objetivosFechas.js`; `fechaLocal` de `fechas.js`.
- Produces: `async capturarMeta(DB, clave, datos, { usuario, vendedor_id, drive, antesDeGuardar, hoy })` → captura; `anularCaptura(DB, id, motivo, usuario)` → captura; `capturaParaRespuesta(captura)` (sin `drive_file_id`). `datos = { fecha, cantidad?, link?, archivo?, nota? }`. `hoy` opcional (por defecto `fechaLocal(new Date())`) para poder probar.
- Forma: `{ id, meta_clave, meta_id, periodo, inicio, fecha, vendedor_id, sucursal_id, cantidad, evidencia (null | {tipo:"link", link} | {tipo:"foto", nombre_archivo, huella, drive_file_id, drive_link}), nota, creado_por_id, creado_por, creado_en, anulada (null | {por_id, por_nombre, en, motivo}) }`.

- [ ] **Step 1: Pruebas que fallan** (`backend/metasCapturas.test.js`)

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("./metasPersonalizadas");
const { capturarMeta, anularCaptura, capturaParaRespuesta } = require("./metasCapturas");

const VICTOR = { id: 1, nombre: "Victor" };
const ANA = { id: 10, nombre: "Ana" };
const HOY = "2026-10-15";
const driveFalso = {
  asegurarCarpetaActividadesSucursal: async () => "carpeta",
  subirArchivoADrive: async () => ({ id: "archivo-privado", webViewLink: "https://drive.google.com/file/d/x/view" }),
};
function DBPrueba() {
  return { pos: {
    sucursales: [{ id: 1, nombre: "Ocosingo" }, { id: 4, nombre: "Palenque" }],
    vendedores: [{ id: 1, nombre: "Ana", sucursal_id: 4 }, { id: 2, nombre: "Luis", sucursal_id: 4 }, { id: 3, nombre: "Eva", sucursal_id: 1 }],
    objetivo_plantilla: [], objetivo_actividades: [], objetivo_inventarios: [],
    okrs: [], metas_personalizadas: [], meta_capturas: [], meta_sellos: [],
  } };
}
const metaTienda = (DB, prueba = "liga") => M.crearMeta(DB, { nombre: "Videos", unidad: "videos", prueba, valor_meta: 12,
  periodo: "mensual", inicio: "2026-10-01", alcance: "tienda", sucursal_id: 4 }, VICTOR);
const capturar = (DB, clave, datos, vendedor_id = 1, extra = {}) =>
  capturarMeta(DB, clave, datos, { usuario: ANA, vendedor_id, drive: driveFalso, hoy: HOY, ...extra });

test("Hecho con liga cuenta 1 y guarda la liga normalizada", async () => {
  const DB = DBPrueba();
  const meta = metaTienda(DB);
  const c = await capturar(DB, meta.clave, { fecha: "2026-10-14", link: "https://www.TikTok.com/@unisound/video/1?utm_source=x" });
  assert.equal(c.cantidad, 1);
  assert.equal(c.evidencia.link, "https://tiktok.com/@unisound/video/1");
  assert.equal(c.sucursal_id, 4);
  assert.equal(c.vendedor_id, 1);
});

test("la misma liga no cuenta dos veces, ni con otra persona ni si ya fue actividad", async () => {
  const DB = DBPrueba();
  const meta = metaTienda(DB);
  await capturar(DB, meta.clave, { fecha: "2026-10-14", link: "https://tiktok.com/@u/video/1" });
  await assert.rejects(capturar(DB, meta.clave, { fecha: "2026-10-14", link: "https://m.tiktok.com/@u/video/1/?fbclid=z" }, 2), /ya se usó/);
  DB.pos.objetivo_actividades.push({ vigente: true, evidencia: { tipo: "link", link: "https://facebook.com/p/9" } });
  await assert.rejects(capturar(DB, meta.clave, { fecha: "2026-10-14", link: "https://www.facebook.com/p/9" }), /ya se usó/);
});

test("prueba equivocada, fecha fuera del periodo o futura, y meta sin prueba con cantidad", async () => {
  const DB = DBPrueba();
  const meta = metaTienda(DB);
  await assert.rejects(capturar(DB, meta.clave, { fecha: "2026-10-14" }), /link/);
  await assert.rejects(capturar(DB, meta.clave, { fecha: "2026-09-30", link: "https://x.com/1" }), /periodo/);
  await assert.rejects(capturar(DB, meta.clave, { fecha: "2026-10-16", link: "https://x.com/1" }), /futura/);
  await assert.rejects(capturar(DB, meta.clave, { fecha: "2026-10-14", link: "https://x.com/1", cantidad: 3 }), /cantidad/);
  const llamadas = metaTienda(DB, "ninguna");
  const c = await capturar(DB, llamadas.clave, { fecha: "2026-10-14", cantidad: 7 });
  assert.equal(c.cantidad, 7);
  assert.equal(c.evidencia, null);
  await assert.rejects(capturar(DB, llamadas.clave, { fecha: "2026-10-14", cantidad: 0 }), /cantidad/);
  await assert.rejects(capturar(DB, llamadas.clave, { fecha: "2026-10-14", cantidad: 1, link: "https://x.com/2" }), /no lleva prueba/);
});

test("quién puede capturar: persona, tienda y empresa", async () => {
  const DB = DBPrueba();
  const persona = M.crearMeta(DB, { nombre: "Mis videos", unidad: "videos", prueba: "ninguna", valor_meta: 4,
    periodo: "mensual", inicio: "2026-10-01", alcance: "persona", vendedor_id: 2 }, VICTOR);
  await assert.rejects(capturar(DB, persona.clave, { fecha: "2026-10-14", cantidad: 1 }, 1), /no es tuya/);
  const tienda = metaTienda(DB, "ninguna");
  await assert.rejects(capturar(DB, tienda.clave, { fecha: "2026-10-14", cantidad: 1 }, 3), /sucursal|plantilla/);
  const empresa = M.crearMeta(DB, { nombre: "Talleres", unidad: "talleres", prueba: "ninguna", valor_meta: 2,
    periodo: "mensual", inicio: "2026-10-01", alcance: "empresa", participantes: [3] }, VICTOR);
  await assert.rejects(capturar(DB, empresa.clave, { fecha: "2026-10-14", cantidad: 1 }, 1), /no participas/);
  const c = await capturar(DB, empresa.clave, { fecha: "2026-10-14", cantidad: 1 }, 3);
  assert.equal(c.sucursal_id, 1);
  await assert.rejects(capturar(DB, tienda.clave, { fecha: "2026-10-14", cantidad: 1 }, null), /ligada/);
});

test("foto: sube a Drive, la misma foto no cuenta dos veces y la respuesta no expone drive_file_id", async () => {
  const DB = DBPrueba();
  const meta = metaTienda(DB, "foto");
  const archivo = { contenido_base64: Buffer.from("foto-1").toString("base64"), tipo_mime: "image/jpeg", nombre_archivo: "a.jpg" };
  const c = await capturar(DB, meta.clave, { fecha: "2026-10-14", archivo });
  assert.equal(c.evidencia.tipo, "foto");
  assert.ok(!JSON.stringify(capturaParaRespuesta(c)).includes("drive_file_id"));
  await assert.rejects(capturar(DB, meta.clave, { fecha: "2026-10-14", archivo }, 2), /ya se usó/);
});

test("si el periodo se sella mientras sube la foto, no se guarda", async () => {
  const DB = DBPrueba();
  const meta = metaTienda(DB, "foto");
  const archivo = { contenido_base64: Buffer.from("foto-2").toString("base64"), tipo_mime: "image/png", nombre_archivo: "b.png" };
  const antesDeGuardar = () => { if (M.periodoSellado(DB, "mensual", "2026-10-01")) throw new Error("El periodo ya está sellado"); };
  DB.pos.meta_sellos.push({ id: 1, periodo: "mensual", inicio: "2026-11-01" });
  const drive = { ...driveFalso, subirArchivoADrive: async () => { DB.pos.meta_sellos.push({ id: 2, periodo: "mensual", inicio: "2026-10-01" }); return driveFalso.subirArchivoADrive(); } };
  await assert.rejects(capturar(DB, meta.clave, { fecha: "2026-10-14", archivo }, 1, { drive, antesDeGuardar }), /sellado/);
  assert.equal(DB.pos.meta_capturas.length, 0);
});

test("anular con motivo; no dos veces; no en periodo sellado; la liga anulada se puede volver a usar", async () => {
  const DB = DBPrueba();
  const meta = metaTienda(DB);
  const c = await capturar(DB, meta.clave, { fecha: "2026-10-14", link: "https://x.com/v/1" });
  assert.throws(() => anularCaptura(DB, c.id, "  ", VICTOR), /motivo/);
  const anulada = anularCaptura(DB, c.id, "Liga de otro video", VICTOR);
  assert.equal(anulada.anulada.por_nombre, "Victor");
  assert.throws(() => anularCaptura(DB, c.id, "otra", VICTOR), /ya está anulada/);
  const nueva = await capturar(DB, meta.clave, { fecha: "2026-10-14", link: "https://x.com/v/1" });
  DB.pos.meta_sellos.push({ id: 1, periodo: "mensual", inicio: "2026-10-01" });
  assert.throws(() => anularCaptura(DB, nueva.id, "x", VICTOR), /sellado/);
  await assert.rejects(capturar(DB, meta.clave, { fecha: "2026-10-14", link: "https://x.com/v/2" }), /sellado/);
});
```

- [ ] **Step 2:** `node --preserve-symlinks --preserve-symlinks-main --test metasCapturas.test.js` → FAIL (módulo no existe).

- [ ] **Step 3: Implementar** `backend/metasCapturas.js`

```js
// Captura de metas personalizadas: la persona marca "Hecho" con su prueba y cuenta al momento
// (decisión de Victor 2026-10-08). La jefatura revisa y anula con motivo. Una liga o una foto
// solo cuenta una vez en todo el sistema (metas y actividades).
const { metaVigente, periodoSellado, motivoObligatorio } = require("./metasPersonalizadas");
const { finDePeriodo } = require("./metasPeriodos");
const { normalizarLink, prepararEvidencia, subidasEnCurso } = require("./objetivosActividades");
const { validarFechaYPlantilla, fechaValida } = require("./objetivosFechas");
const { fechaLocal } = require("./fechas");

const siguienteId = (lista) => lista.reduce((maximo, r) => Math.max(maximo, r.id), 0) + 1;

function linkGuardado(link) {
  try { return normalizarLink(link); } catch { return link; }
}

function validarEvidenciaUnica(DB, evidencia) {
  if (!evidencia) return;
  const enMetas = DB.pos.meta_capturas.filter((c) => !c.anulada && c.evidencia?.tipo === evidencia.tipo);
  const enActividades = (DB.pos.objetivo_actividades || []).filter((r) => r.vigente && r.evidencia?.tipo === evidencia.tipo);
  if (evidencia.tipo === "link") {
    if ([...enMetas, ...enActividades].some((r) => linkGuardado(r.evidencia.link) === evidencia.link)) {
      throw new Error("Esta liga ya se usó como prueba; no puede contar dos veces");
    }
    return;
  }
  const enInventarios = (DB.pos.objetivo_inventarios || []).some((r) => (r.evidencias || []).some((e) => e.huella === evidencia.huella));
  if (enInventarios || [...enMetas, ...enActividades].some((r) => r.evidencia.huella === evidencia.huella)) {
    throw new Error("Esta foto ya se usó como prueba; no puede contar dos veces");
  }
}

function validarParticipacion(DB, meta, vendedor_id, fecha) {
  if (vendedor_id === null || vendedor_id === undefined) throw new Error("Tu cuenta no está ligada a un vendedor");
  if (meta.alcance === "persona") {
    if (vendedor_id !== meta.vendedor_id) throw new Error("Esta meta no es tuya");
    return meta.sucursal_id;
  }
  if (meta.alcance === "empresa") {
    if (!meta.participantes.includes(vendedor_id)) throw new Error("No participas en esta meta");
    const vendedor = DB.pos.vendedores.find((v) => v.id === vendedor_id);
    if (!vendedor) throw new Error("El vendedor no existe");
    return vendedor.sucursal_id;
  }
  // Meta de tienda: solo quien ese día está en esa tienda (plantilla del mes o tienda del vendedor).
  validarFechaYPlantilla(DB, { mes: fecha.slice(0, 7), fecha, sucursal_id: meta.sucursal_id, vendedor_id });
  return meta.sucursal_id;
}

function cantidadYEvidencia(meta, datos) {
  if (meta.prueba === "ninguna") {
    if ((datos.link !== undefined && datos.link !== null) || (datos.archivo !== undefined && datos.archivo !== null)) {
      throw new Error("Esta meta no lleva prueba; captura solo la cantidad");
    }
    if (!Number.isInteger(datos.cantidad) || datos.cantidad < 1 || datos.cantidad > 1000) {
      throw new Error("La cantidad debe ser un entero entre 1 y 1000");
    }
    return { cantidad: datos.cantidad, evidencia: null, buffer: null };
  }
  if (datos.cantidad !== undefined && datos.cantidad !== null && datos.cantidad !== 1) {
    throw new Error("Con prueba, cada captura cuenta 1; la cantidad no se puede cambiar");
  }
  const { evidencia, buffer } = prepararEvidencia({ evidencia: meta.prueba === "liga" ? "link" : "foto" }, datos);
  return { cantidad: 1, evidencia, buffer: buffer || null };
}

function normalizarNota(nota) {
  if (nota === undefined || nota === null) return null;
  if (typeof nota !== "string") throw new Error("La nota debe ser texto");
  const limpio = nota.trim();
  if (limpio.length > 300) throw new Error("La nota no puede tener más de 300 caracteres");
  return limpio || null;
}

async function capturarMeta(DB, clave, datos, { usuario, vendedor_id, drive, antesDeGuardar, hoy = fechaLocal(new Date()) }) {
  const meta = metaVigente(DB, clave);
  if (!meta) throw new Error("La meta no existe o fue eliminada");
  if (periodoSellado(DB, meta.periodo, meta.inicio)) throw new Error("El periodo ya está sellado; no se puede capturar");
  const fecha = datos?.fecha;
  if (!fechaValida(fecha)) throw new Error("La fecha debe tener formato AAAA-MM-DD y ser válida");
  if (fecha > hoy) throw new Error("No se puede capturar una fecha futura");
  if (fecha < meta.inicio || fecha > finDePeriodo(meta.periodo, meta.inicio)) throw new Error("La fecha no cae dentro del periodo de la meta");
  const sucursal_id = validarParticipacion(DB, meta, vendedor_id, fecha);
  const nota = normalizarNota(datos.nota);
  const { cantidad, evidencia, buffer } = cantidadYEvidencia(meta, datos);
  validarEvidenciaUnica(DB, evidencia);
  if (evidencia?.tipo === "foto") {
    if (subidasEnCurso.has(evidencia.huella)) throw new Error("Ya se está subiendo esta foto; inténtalo de nuevo al terminar");
    subidasEnCurso.add(evidencia.huella);
    try {
      const sucursal = DB.pos.sucursales.find((s) => s.id === sucursal_id) || { id: sucursal_id };
      const vendedor = DB.pos.vendedores.find((v) => v.id === vendedor_id);
      const carpetaId = await drive.asegurarCarpetaActividadesSucursal(DB, sucursal);
      const subido = await drive.subirArchivoADrive(DB, {
        nombre: `${fecha} - ${vendedor?.nombre || vendedor_id} - meta ${meta.clave} - ${evidencia.nombre_archivo}`,
        mimeType: datos.archivo.tipo_mime, contenidoBuffer: buffer, carpetaId,
      });
      if (!subido || !subido.id || !subido.webViewLink) throw new Error("Drive no confirmó la subida de la foto; inténtalo de nuevo");
      validarEvidenciaUnica(DB, evidencia);
      evidencia.drive_file_id = subido.id;
      evidencia.drive_link = subido.webViewLink;
    } finally {
      subidasEnCurso.delete(evidencia.huella);
    }
  }
  if (antesDeGuardar) antesDeGuardar();
  if (periodoSellado(DB, meta.periodo, meta.inicio)) throw new Error("El periodo ya está sellado; no se puede capturar");
  const captura = {
    id: siguienteId(DB.pos.meta_capturas), meta_clave: meta.clave, meta_id: meta.id, periodo: meta.periodo, inicio: meta.inicio,
    fecha, vendedor_id, sucursal_id, cantidad, evidencia, nota,
    creado_por_id: usuario?.id ?? null, creado_por: usuario?.nombre || "desconocido", creado_en: new Date().toISOString(),
    anulada: null,
  };
  DB.pos.meta_capturas.push(captura);
  return captura;
}

function anularCaptura(DB, id, motivo, usuario) {
  const captura = DB.pos.meta_capturas.find((c) => c.id === Number(id));
  if (!captura) throw new Error("La captura no existe");
  if (captura.anulada) throw new Error("La captura ya está anulada");
  if (periodoSellado(DB, captura.periodo, captura.inicio)) throw new Error("El periodo ya está sellado; no se puede anular");
  captura.anulada = { por_id: usuario?.id ?? null, por_nombre: usuario?.nombre || "desconocido",
    en: new Date().toISOString(), motivo: motivoObligatorio(motivo, "Anular una captura") };
  return captura;
}

function capturaParaRespuesta(captura) {
  if (captura.evidencia?.tipo !== "foto") return { ...captura };
  const { drive_file_id, ...evidencia } = captura.evidencia;
  return { ...captura, evidencia };
}

module.exports = { capturarMeta, anularCaptura, capturaParaRespuesta };
```

Nota: el mensaje de "fecha" en la prueba de liga faltante (`/link/`) sale de `prepararEvidencia` ("El link debe empezar con http:// o https://"). Si `prepararEvidencia` rechaza `{ evidencia: "foto" }` con otro texto, ajustar la regex de la prueba al mensaje real, nunca el mensaje de `prepararEvidencia`.

- [ ] **Step 4:** mismo comando → PASS; correr también `objetivosActividades.test.js` (no debe cambiar nada).
- [ ] **Step 5: Commit** (Claude): `feat(metas): captura con liga, foto o cantidad y anular con motivo`

---

### Task 5: avance, OKRs y tablero con privacidad

**Files:**
- Create: `backend/metasAvance.js`
- Test: `backend/metasAvance.test.js`

**Interfaces:**
- Consumes: Tasks 1, 3; `meta_capturas` de Task 4; sellos de Task 6 solo vía `resultadoRectificado` (se define AQUÍ, Task 6 lo reutiliza).
- Produces: `resultadoMeta(DB, meta) -> entero`, `porcentaje(resultado, valor) -> 0..100 con 1 decimal`, `semaforo(porcentaje, ritmo) -> "verde"|"amarillo"|"rojo"`, `resultadoRectificado(DB, meta)` (si el periodo está sellado: última rectificación de esa meta o el resultado sellado; si no: `resultadoMeta`), `tablero(DB, visor, { periodo, inicio, sucursal_id?, vendedor_id? }, hoy)`.
- `visor = { vendedor_id: número|null, jefatura: bool, verTodas: bool, sucursalId: número|null }`.
- Respuesta de `tablero`: `{ periodo, inicio, fin, sellado, okrs: [{ clave, titulo, descripcion, alcance, sucursal_id, vendedor_id, porcentaje|null, metas: [AvanceMeta] }], sueltas: [AvanceMeta] }` con `AvanceMeta = { clave, okr_clave, nombre, descripcion, unidad, prueba, alcance, sucursal_id, vendedor_id, valor_meta, resultado, porcentaje, ritmo, semaforo, mis_capturas: [capturaParaRespuesta], por_persona?: [{ vendedor_id, nombre, resultado }] }`.

- [ ] **Step 1: Pruebas que fallan** (`backend/metasAvance.test.js`)

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("./metasPersonalizadas");
const { porcentaje, semaforo, resultadoMeta, tablero } = require("./metasAvance");

const VICTOR = { id: 1, nombre: "Victor" };
function DBPrueba() {
  return { pos: {
    sucursales: [{ id: 1, nombre: "Ocosingo" }, { id: 4, nombre: "Palenque" }],
    vendedores: [{ id: 1, nombre: "Ana", sucursal_id: 4 }, { id: 2, nombre: "Luis", sucursal_id: 4 }, { id: 3, nombre: "Eva", sucursal_id: 1 }],
    okrs: [], metas_personalizadas: [], meta_capturas: [], meta_sellos: [],
  } };
}
const BASE = { periodo: "mensual", inicio: "2026-10-01" };
const captura = (DB, meta, vendedor_id, cantidad, extra = {}) => DB.pos.meta_capturas.push({
  id: DB.pos.meta_capturas.length + 1, meta_clave: meta.clave, meta_id: meta.id, ...BASE, fecha: "2026-10-03",
  vendedor_id, sucursal_id: 4, cantidad, evidencia: null, nota: null, anulada: null, ...extra });

test("porcentaje topado a 100 y semáforo contra el ritmo", () => {
  assert.equal(porcentaje(6, 12), 50);
  assert.equal(porcentaje(30, 12), 100);
  assert.equal(porcentaje(1, 3), 33.3);
  assert.equal(semaforo(50, 0.5), "verde");
  assert.equal(semaforo(36, 0.5), "amarillo");
  assert.equal(semaforo(34, 0.5), "rojo");
  assert.equal(semaforo(0, 0), "verde");
});

test("las capturas anuladas no suman", () => {
  const DB = DBPrueba();
  const meta = M.crearMeta(DB, { ...BASE, nombre: "Videos", unidad: "videos", prueba: "ninguna", valor_meta: 12, alcance: "tienda", sucursal_id: 4 }, VICTOR);
  captura(DB, meta, 1, 3);
  captura(DB, meta, 2, 2, { anulada: { motivo: "x" } });
  assert.equal(resultadoMeta(DB, meta), 3);
});

test("OKR = promedio de sus metas vigentes, cada una topada a 100", () => {
  const DB = DBPrueba();
  const okr = M.crearOkr(DB, { ...BASE, titulo: "Redes Palenque", alcance: "tienda", sucursal_id: 4 }, VICTOR);
  const a = M.crearMeta(DB, { okr_clave: okr.clave, nombre: "Videos", unidad: "videos", prueba: "ninguna", valor_meta: 10 }, VICTOR);
  const b = M.crearMeta(DB, { okr_clave: okr.clave, nombre: "Reseñas", unidad: "reseñas", prueba: "ninguna", valor_meta: 10 }, VICTOR);
  const c = M.crearMeta(DB, { okr_clave: okr.clave, nombre: "Talleres", unidad: "talleres", prueba: "ninguna", valor_meta: 2 }, VICTOR);
  captura(DB, a, 1, 20); captura(DB, b, 1, 5);
  M.retirarMeta(DB, c.clave, "ya no", VICTOR);
  const visor = { vendedor_id: null, jefatura: true, verTodas: true, sucursalId: null };
  const t = tablero(DB, visor, BASE, "2026-10-15");
  assert.equal(t.okrs[0].porcentaje, 75);
  assert.equal(t.okrs[0].metas.length, 2);
});

test("vendedora: ve sus metas, las de su tienda y empresa donde participa; sin desglose ni capturas ajenas", () => {
  const DB = DBPrueba();
  const tienda = M.crearMeta(DB, { ...BASE, nombre: "Videos", unidad: "videos", prueba: "ninguna", valor_meta: 12, alcance: "tienda", sucursal_id: 4 }, VICTOR);
  M.crearMeta(DB, { ...BASE, nombre: "Otra tienda", unidad: "x", prueba: "ninguna", valor_meta: 1, alcance: "tienda", sucursal_id: 1 }, VICTOR);
  M.crearMeta(DB, { ...BASE, nombre: "De Luis", unidad: "x", prueba: "ninguna", valor_meta: 1, alcance: "persona", vendedor_id: 2 }, VICTOR);
  M.crearMeta(DB, { ...BASE, nombre: "Empresa ajena", unidad: "x", prueba: "ninguna", valor_meta: 1, alcance: "empresa", participantes: [3] }, VICTOR);
  captura(DB, tienda, 1, 2); captura(DB, tienda, 2, 4);
  const ana = { vendedor_id: 1, jefatura: false, verTodas: false, sucursalId: 4 };
  const t = tablero(DB, ana, BASE, "2026-10-15");
  assert.deepEqual(t.sueltas.map((m) => m.nombre), ["Videos"]);
  assert.equal(t.sueltas[0].resultado, 6);
  assert.equal(t.sueltas[0].por_persona, undefined);
  assert.deepEqual(t.sueltas[0].mis_capturas.map((c) => c.vendedor_id), [1]);
});

test("jefatura de tienda: solo su tienda, con desglose por persona; sin empresa", () => {
  const DB = DBPrueba();
  const tienda = M.crearMeta(DB, { ...BASE, nombre: "Videos", unidad: "videos", prueba: "ninguna", valor_meta: 12, alcance: "tienda", sucursal_id: 4 }, VICTOR);
  M.crearMeta(DB, { ...BASE, nombre: "Otra tienda", unidad: "x", prueba: "ninguna", valor_meta: 1, alcance: "tienda", sucursal_id: 1 }, VICTOR);
  M.crearMeta(DB, { ...BASE, nombre: "Empresa", unidad: "x", prueba: "ninguna", valor_meta: 1, alcance: "empresa", participantes: [1] }, VICTOR);
  captura(DB, tienda, 1, 2); captura(DB, tienda, 2, 4);
  const gerente = { vendedor_id: null, jefatura: true, verTodas: false, sucursalId: 4 };
  const t = tablero(DB, gerente, BASE, "2026-10-15");
  assert.deepEqual(t.sueltas.map((m) => m.nombre), ["Videos"]);
  assert.deepEqual(t.sueltas[0].por_persona, [{ vendedor_id: 1, nombre: "Ana", resultado: 2 }, { vendedor_id: 2, nombre: "Luis", resultado: 4 }]);
});

test("periodo sellado: el tablero usa el resultado rectificado", () => {
  const DB = DBPrueba();
  const meta = M.crearMeta(DB, { ...BASE, nombre: "Videos", unidad: "videos", prueba: "ninguna", valor_meta: 10, alcance: "tienda", sucursal_id: 4 }, VICTOR);
  captura(DB, meta, 1, 4);
  DB.pos.meta_sellos.push({ id: 1, ...BASE, foto: { resultados: [{ clave: meta.clave, resultado: 4 }] },
    rectificaciones: [{ meta_clave: meta.clave, valor_nuevo: 5 }] });
  const t = tablero(DB, { vendedor_id: null, jefatura: true, verTodas: true, sucursalId: null }, BASE, "2026-11-05");
  assert.equal(t.sellado, true);
  assert.equal(t.sueltas[0].resultado, 5);
  assert.equal(t.sueltas[0].porcentaje, 50);
});
```

- [ ] **Step 2:** `node --preserve-symlinks --preserve-symlinks-main --test metasAvance.test.js` → FAIL.

- [ ] **Step 3: Implementar** `backend/metasAvance.js`

```js
// Avance de metas personalizadas. Son conteos, no dinero: la vendedora ve el total y el % de las
// metas compartidas, pero nunca quién capturó qué (solo lo suyo). La jefatura ve el desglose.
const { validarPeriodo, finDePeriodo, ritmoEsperado } = require("./metasPeriodos");
const { periodoSellado } = require("./metasPersonalizadas");
const { capturaParaRespuesta } = require("./metasCapturas");

const validas = (DB, meta) => DB.pos.meta_capturas.filter((c) => c.meta_clave === meta.clave && !c.anulada);

function resultadoMeta(DB, meta) {
  return validas(DB, meta).reduce((suma, c) => suma + c.cantidad, 0);
}

function porcentaje(resultado, valor) {
  return Math.min(100, Math.round((resultado / valor) * 1000) / 10);
}

function semaforo(pct, ritmo) {
  const esperado = ritmo * 100;
  if (pct >= esperado) return "verde";
  if (pct >= esperado * 0.7) return "amarillo";
  return "rojo";
}

function selloDe(DB, periodo, inicio) {
  return (DB.pos.meta_sellos || []).find((s) => s.periodo === periodo && s.inicio === inicio) || null;
}

function resultadoRectificado(DB, meta) {
  const sello = selloDe(DB, meta.periodo, meta.inicio);
  if (!sello) return resultadoMeta(DB, meta);
  const rectificaciones = (sello.rectificaciones || []).filter((r) => r.meta_clave === meta.clave);
  if (rectificaciones.length) return rectificaciones.at(-1).valor_nuevo;
  const sellado = (sello.foto?.resultados || []).find((r) => r.clave === meta.clave);
  return sellado ? sellado.resultado : resultadoMeta(DB, meta);
}

function puedeVer(DB, meta, visor) {
  if (visor.jefatura) {
    if (visor.verTodas) return true;
    return meta.alcance !== "empresa" && meta.sucursal_id === visor.sucursalId;
  }
  if (visor.vendedor_id === null) return false;
  if (meta.alcance === "persona") return meta.vendedor_id === visor.vendedor_id;
  if (meta.alcance === "empresa") return meta.participantes.includes(visor.vendedor_id);
  const propio = DB.pos.vendedores.find((v) => v.id === visor.vendedor_id);
  return Boolean(propio) && propio.sucursal_id === meta.sucursal_id;
}

function avanceMeta(DB, meta, visor, ritmo) {
  const resultado = resultadoRectificado(DB, meta);
  const pct = porcentaje(resultado, meta.valor_meta);
  const capturas = validas(DB, meta);
  const avance = {
    clave: meta.clave, okr_clave: meta.okr_clave, nombre: meta.nombre, descripcion: meta.descripcion, unidad: meta.unidad,
    prueba: meta.prueba, alcance: meta.alcance, sucursal_id: meta.sucursal_id, vendedor_id: meta.vendedor_id,
    valor_meta: meta.valor_meta, resultado, porcentaje: pct, ritmo, semaforo: semaforo(pct, ritmo),
    mis_capturas: capturas.filter((c) => c.vendedor_id === visor.vendedor_id).map(capturaParaRespuesta),
  };
  if (visor.jefatura) {
    const porPersona = new Map();
    for (const c of capturas) porPersona.set(c.vendedor_id, (porPersona.get(c.vendedor_id) || 0) + c.cantidad);
    avance.por_persona = [...porPersona].sort(([a], [b]) => a - b).map(([vendedor_id, total]) => ({
      vendedor_id, nombre: DB.pos.vendedores.find((v) => v.id === vendedor_id)?.nombre || "desconocido", resultado: total,
    }));
  }
  return avance;
}

function tablero(DB, visor, { periodo, inicio, sucursal_id = null, vendedor_id = null }, hoy) {
  validarPeriodo(periodo, inicio);
  const ritmo = ritmoEsperado(periodo, inicio, hoy);
  const filtro = (m) => (sucursal_id === null || m.sucursal_id === sucursal_id) && (vendedor_id === null || m.vendedor_id === vendedor_id);
  const metas = DB.pos.metas_personalizadas
    .filter((m) => m.vigente && m.periodo === periodo && m.inicio === inicio && puedeVer(DB, m, visor) && filtro(m))
    .map((m) => avanceMeta(DB, m, visor, ritmo));
  const okrs = DB.pos.okrs
    .filter((o) => o.vigente && o.periodo === periodo && o.inicio === inicio)
    .map((o) => {
      const suyas = metas.filter((m) => m.okr_clave === o.clave);
      const pct = suyas.length ? Math.round((suyas.reduce((s, m) => s + m.porcentaje, 0) / suyas.length) * 10) / 10 : null;
      return { clave: o.clave, titulo: o.titulo, descripcion: o.descripcion, alcance: o.alcance, sucursal_id: o.sucursal_id,
        vendedor_id: o.vendedor_id, porcentaje: pct, metas: suyas };
    })
    .filter((o) => o.metas.length);
  return { periodo, inicio, fin: finDePeriodo(periodo, inicio), sellado: periodoSellado(DB, periodo, inicio),
    okrs, sueltas: metas.filter((m) => m.okr_clave === null) };
}

module.exports = { resultadoMeta, porcentaje, semaforo, resultadoRectificado, tablero };
```

- [ ] **Step 4:** mismo comando → PASS.
- [ ] **Step 5: Commit** (Claude): `feat(metas): avance, okrs y tablero con privacidad`

---

### Task 6: sellar periodo y rectificar

**Files:**
- Create: `backend/metasSellos.js`
- Test: `backend/metasSellos.test.js`

**Interfaces:**
- Consumes: Tasks 1, 3, 5 (`resultadoMeta`, `resultadoRectificado`, `porcentaje`).
- Produces: `previoSello(DB, { periodo, inicio }, hoy)`, `sellarPeriodo(DB, { periodo, inicio }, usuario, hoy)`, `rectificarSello(DB, selloId, { meta_clave, valor_nuevo, motivo }, usuario)`.
- Forma del sello: `{ id, periodo, inicio, fin, sellado_por_id, sellado_por, sellado_en, foto: { okrs, metas, capturas, resultados: [{ clave, nombre, alcance, sucursal_id, vendedor_id, valor_meta, resultado, porcentaje }] }, rectificaciones: [{ id, meta_clave, valor_anterior, valor_nuevo, motivo, por_id, por_nombre, en }] }`.

- [ ] **Step 1: Pruebas que fallan** (`backend/metasSellos.test.js`)

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("./metasPersonalizadas");
const { previoSello, sellarPeriodo, rectificarSello } = require("./metasSellos");

const VICTOR = { id: 1, nombre: "Victor" };
const BASE = { periodo: "semanal", inicio: "2026-10-05" };
function DBPrueba() {
  return { pos: {
    sucursales: [{ id: 4, nombre: "Palenque" }], vendedores: [{ id: 1, nombre: "Ana", sucursal_id: 4 }],
    okrs: [], metas_personalizadas: [], meta_capturas: [], meta_sellos: [],
  } };
}
function conMeta() {
  const DB = DBPrueba();
  const meta = M.crearMeta(DB, { ...BASE, nombre: "Videos", unidad: "videos", prueba: "ninguna", valor_meta: 4, alcance: "tienda", sucursal_id: 4 }, VICTOR);
  DB.pos.meta_capturas.push({ id: 1, meta_clave: meta.clave, meta_id: meta.id, ...BASE, fecha: "2026-10-06", vendedor_id: 1,
    sucursal_id: 4, cantidad: 3, evidencia: null, nota: null, anulada: null });
  return { DB, meta };
}

test("no se sella un periodo que no ha terminado", () => {
  const { DB } = conMeta();
  assert.throws(() => previoSello(DB, BASE, "2026-10-11"), /todavía no termina/);
  assert.equal(previoSello(DB, BASE, "2026-10-12").resultados[0].resultado, 3);
});

test("sellar congela una copia y no se sella dos veces", () => {
  const { DB, meta } = conMeta();
  const sello = sellarPeriodo(DB, BASE, VICTOR, "2026-10-12");
  assert.equal(sello.sellado_por, "Victor");
  assert.equal(sello.foto.resultados[0].resultado, 3);
  DB.pos.meta_capturas[0].cantidad = 99;
  assert.equal(sello.foto.capturas[0].cantidad, 3);
  assert.throws(() => sellarPeriodo(DB, BASE, VICTOR, "2026-10-12"), /ya está sellado/);
  assert.equal(M.periodoSellado(DB, BASE.periodo, BASE.inicio), true);
  assert.ok(meta);
});

test("rectificar cambia el resultado con motivo, conserva el sellado y lee el valor anterior", () => {
  const { DB, meta } = conMeta();
  const sello = sellarPeriodo(DB, BASE, VICTOR, "2026-10-12");
  assert.throws(() => rectificarSello(DB, sello.id, { meta_clave: meta.clave, valor_nuevo: 4, motivo: " " }, VICTOR), /motivo/);
  assert.throws(() => rectificarSello(DB, sello.id, { meta_clave: meta.clave, valor_nuevo: -1, motivo: "x" }, VICTOR), /entero/);
  assert.throws(() => rectificarSello(DB, sello.id, { meta_clave: 999, valor_nuevo: 1, motivo: "x" }, VICTOR), /no está en este sello/);
  assert.throws(() => rectificarSello(DB, sello.id, { meta_clave: meta.clave, campo: "valor_meta", valor_nuevo: 1, motivo: "x" }, VICTOR), /cifra meta/);
  const r1 = rectificarSello(DB, sello.id, { meta_clave: meta.clave, valor_nuevo: 4, motivo: "Faltó un video" }, VICTOR);
  assert.equal(r1.valor_anterior, 3);
  const r2 = rectificarSello(DB, sello.id, { meta_clave: meta.clave, valor_nuevo: 2, motivo: "Uno era repetido" }, VICTOR);
  assert.equal(r2.valor_anterior, 4);
  assert.equal(sello.foto.resultados[0].resultado, 3);
});
```

- [ ] **Step 2:** `node --preserve-symlinks --preserve-symlinks-main --test metasSellos.test.js` → FAIL.

- [ ] **Step 3: Implementar** `backend/metasSellos.js`

```js
// Sello de un periodo de metas personalizadas (decisión de Victor 2026-10-08): al terminar el periodo,
// el Administrador lo sella; después nada cambia. Rectificar corrige el RESULTADO con motivo y deja
// el sellado intacto; la cifra meta nunca se rectifica (sería maquillar el cumplimiento).
const { validarPeriodo, finDePeriodo } = require("./metasPeriodos");
const { periodoSellado, motivoObligatorio } = require("./metasPersonalizadas");
const { resultadoMeta, resultadoRectificado, porcentaje } = require("./metasAvance");

const siguienteId = (lista) => lista.reduce((maximo, r) => Math.max(maximo, r.id), 0) + 1;

function previoSello(DB, { periodo, inicio }, hoy) {
  validarPeriodo(periodo, inicio);
  const fin = finDePeriodo(periodo, inicio);
  if (hoy <= fin) throw new Error("El periodo todavía no termina; se sella a partir del día siguiente a su fin");
  if (periodoSellado(DB, periodo, inicio)) throw new Error("El periodo ya está sellado");
  const metas = DB.pos.metas_personalizadas.filter((m) => m.vigente && m.periodo === periodo && m.inicio === inicio);
  return {
    periodo, inicio, fin,
    resultados: metas.map((m) => {
      const resultado = resultadoMeta(DB, m);
      return { clave: m.clave, nombre: m.nombre, alcance: m.alcance, sucursal_id: m.sucursal_id, vendedor_id: m.vendedor_id,
        valor_meta: m.valor_meta, resultado, porcentaje: porcentaje(resultado, m.valor_meta) };
    }),
  };
}

function sellarPeriodo(DB, datos, usuario, hoy) {
  const previo = previoSello(DB, datos, hoy);
  const { periodo, inicio } = datos;
  const claves = new Set(previo.resultados.map((r) => r.clave));
  const foto = structuredClone({
    okrs: DB.pos.okrs.filter((o) => o.vigente && o.periodo === periodo && o.inicio === inicio),
    metas: DB.pos.metas_personalizadas.filter((m) => m.vigente && claves.has(m.clave)),
    capturas: DB.pos.meta_capturas.filter((c) => !c.anulada && claves.has(c.meta_clave)),
    resultados: previo.resultados,
  });
  const sello = { id: siguienteId(DB.pos.meta_sellos), periodo, inicio, fin: previo.fin,
    sellado_por_id: usuario?.id ?? null, sellado_por: usuario?.nombre || "desconocido", sellado_en: new Date().toISOString(),
    foto, rectificaciones: [] };
  DB.pos.meta_sellos.push(sello);
  return sello;
}

function rectificarSello(DB, selloId, { meta_clave, valor_nuevo, motivo, campo }, usuario) {
  const sello = DB.pos.meta_sellos.find((s) => s.id === Number(selloId));
  if (!sello) throw new Error("El sello no existe");
  if (campo !== undefined && campo !== "resultado") throw new Error("Solo se rectifica el resultado; la cifra meta no se puede cambiar");
  const sellado = sello.foto.resultados.find((r) => r.clave === Number(meta_clave));
  if (!sellado) throw new Error("La meta no está en este sello");
  if (!Number.isInteger(valor_nuevo) || valor_nuevo < 0) throw new Error("El resultado debe ser un entero mayor o igual a cero");
  const limpio = motivoObligatorio(motivo, "Rectificar un sello");
  const meta = sello.foto.metas.find((m) => m.clave === sellado.clave);
  const rectificacion = { id: siguienteId(sello.rectificaciones), meta_clave: sellado.clave,
    valor_anterior: resultadoRectificado(DB, meta), valor_nuevo, motivo: limpio,
    por_id: usuario?.id ?? null, por_nombre: usuario?.nombre || "desconocido", en: new Date().toISOString() };
  sello.rectificaciones.push(rectificacion);
  return rectificacion;
}

module.exports = { previoSello, sellarPeriodo, rectificarSello };
```

- [ ] **Step 4:** mismo comando → PASS; y `metasAvance.test.js` sigue en verde.
- [ ] **Step 5: Commit** (Claude): `feat(metas): sellar periodo y rectificar el resultado`

---

### Task 7: rutas HTTP

**Files:**
- Create: `backend/metasRutas.js`
- Modify: `backend/server.js` (registrar las rutas inmediatamente después de la última ruta de `/api/objetivos/cierre/:id/rectificar`, línea ~3010)
- Test: `backend/metasRutas.test.js`

**Interfaces:**
- Consumes: Tasks 3-6; de `server.js`: `DB`, `drive`, `requiereLogin`, `requierePermiso`, `resolverPermisosDeRol`, `resolverAlcanceAutorizado` (línea ~664), `vendedorLigadoAObjetivos` (línea ~2375), `idDeObjetivos` (línea ~2361).
- Produces (todas bajo `requiereLogin`):

| Método y ruta | Permiso | Respuesta |
|---|---|---|
| GET `/api/metas/tablero?periodo&inicio&sucursal_id?&vendedor_id?` | `usar_gerente_ventas` | `tablero(...)` |
| GET `/api/metas/admin?periodo&inicio` | `administrar_metas_personalizadas` | `{ okrs, metas }` vigentes y retiradas del periodo (todas las versiones) |
| POST `/api/metas/okr` · `/api/metas/okr/:clave/editar` · `/api/metas/okr/:clave/retirar` | `administrar_metas_personalizadas` | registro |
| POST `/api/metas` · `/api/metas/:clave/editar` · `/api/metas/:clave/retirar` | `administrar_metas_personalizadas` | registro |
| GET `/api/metas/:clave/historial` | `administrar_metas_personalizadas` | versiones |
| POST `/api/metas/:clave/captura` | `usar_gerente_ventas` | `capturaParaRespuesta` |
| POST `/api/metas/captura/:id/anular` | `usar_gerente_ventas` + (propia, o `anular_capturas_metas` con alcance) | captura |
| GET `/api/metas/revision?periodo&inicio` | `anular_capturas_metas` | capturas del periodo dentro de su alcance, con `vendedor_nombre` y `meta_nombre` |
| GET `/api/metas/sello/previo?periodo&inicio` · POST `/api/metas/sello` · POST `/api/metas/sello/:id/rectificar` | `administrar_metas_personalizadas` | previo / sello / rectificación |

- [ ] **Step 1: Pruebas que fallan** (`backend/metasRutas.test.js`). Copiar el arranque de `backend/objetivosActividadesRutas.test.js` (DB_PATH temporal, `require("./server")`, `sembrarCuentas`, `crearRol`, `firmarToken`, sustitución de `drive.asegurarCarpetaActividadesSucursal` y `drive.subirArchivoADrive`, helper de peticiones). Cuentas: `admin` (Administrador), `gerente` (rol con `usar_gerente_ventas`, `anular_capturas_metas`, sucursal 4), `ana` (rol con `usar_gerente_ventas`, sucursal 4, ligada a vendedor 1 de sucursal 4), `luis` (igual, vendedor 2, sucursal 4), `eva` (sucursal 1, vendedor 3). Usar un periodo SEMANAL pasado completo (p. ej. inicio = lunes de hace 3 semanas, calculado con `inicioDePeriodo("semanal", fechaLocal(new Date()))` menos 21 días) para poder capturar y sellar. Casos:
  1. Todas las rutas sin token → 401.
  2. `POST /api/metas` con `gerente` y con `ana` → 403; con `admin` → 200.
  3. `ana` captura con liga en meta de tienda 4 → 200 y la respuesta no contiene `drive_file_id`; el `vendedor_id` del cuerpo se ignora (mandar `vendedor_id: 2` y comprobar que quedó 1).
  4. `luis` captura la misma liga con `?utm_source=x` → 400 "ya se usó".
  5. `eva` captura en meta de tienda 4 → 400.
  6. `GET /api/metas/tablero` con `ana` → sin `por_persona`, `mis_capturas` solo suyas; con `gerente` → con `por_persona`.
  7. `luis` anula la captura de `ana` → 404; `gerente` la anula con motivo → 200 y `anulada.por_nombre` es el del gerente; `gerente` de sucursal 4 no puede anular una captura de sucursal 1 → 404.
  8. `ana` anula su propia captura con motivo → 200.
  9. `POST /api/metas/sello` con `admin` → 200; después capturar, anular, editar y retirar en ese periodo → 400 "sellado".
  10. `POST /api/metas/sello/:id/rectificar` con `{ campo: "valor_meta" }` → 400; con resultado y motivo → 200.
  11. `app.DB.pos.metas_personalizadas`, `okrs`, `meta_capturas`, `meta_sellos` existen como arreglos al arrancar.

- [ ] **Step 2:** `node --preserve-symlinks --preserve-symlinks-main --test metasRutas.test.js` → FAIL (404 de Express).

- [ ] **Step 3: Implementar** `backend/metasRutas.js`

```js
// Rutas de metas personalizadas. El vendedor sale SIEMPRE de la cuenta, nunca del cuerpo:
// nadie captura a nombre de otro. Lo de otra tienda responde 404, igual que en Objetivos.
const M = require("./metasPersonalizadas");
const { capturarMeta, anularCaptura, capturaParaRespuesta } = require("./metasCapturas");
const { tablero } = require("./metasAvance");
const { previoSello, sellarPeriodo, rectificarSello } = require("./metasSellos");
const { fechaLocal } = require("./fechas");

module.exports = function registrarRutasMetas(app, {
  DB, drive, requiereLogin, requierePermiso, resolverPermisosDeRol, resolverAlcanceAutorizado, vendedorLigadoAObjetivos, idDeObjetivos,
}) {
  const permiso = (clave) => requierePermiso(clave, resolverPermisosDeRol);
  const admin = permiso("administrar_metas_personalizadas");
  const tiene = (req, clave) => resolverPermisosDeRol(req.usuarioToken.rol_id).includes(clave);
  const hoy = () => fechaLocal(new Date());
  const responder = (res, fn) => { try { res.json(fn()); } catch (e) { res.status(400).json({ error: e.message }); } };
  const opcional = (valor, campo) => (valor === undefined || valor === "" ? null : idDeObjetivos(valor, campo));

  function visorDe(req) {
    const { verTodas, sucursalId } = resolverAlcanceAutorizado(req);
    const jefatura = tiene(req, "administrar_metas_personalizadas") || tiene(req, "anular_capturas_metas");
    return { vendedor_id: vendedorLigadoAObjetivos(req), jefatura, verTodas, sucursalId };
  }

  function capturaEnAlcance(req, captura) {
    const { verTodas, sucursalId } = resolverAlcanceAutorizado(req);
    if (verTodas) return true;
    const meta = DB.pos.metas_personalizadas.find((m) => m.clave === captura.meta_clave);
    return meta?.alcance !== "empresa" && captura.sucursal_id === sucursalId;
  }

  app.get("/api/metas/tablero", requiereLogin, permiso("usar_gerente_ventas"), (req, res) => responder(res, () =>
    tablero(DB, visorDe(req), { periodo: req.query.periodo, inicio: req.query.inicio,
      sucursal_id: opcional(req.query.sucursal_id, "sucursal_id"), vendedor_id: opcional(req.query.vendedor_id, "vendedor_id") }, hoy())));

  app.get("/api/metas/admin", requiereLogin, admin, (req, res) => responder(res, () => {
    const delPeriodo = (r) => r.periodo === req.query.periodo && r.inicio === req.query.inicio;
    return { okrs: DB.pos.okrs.filter(delPeriodo), metas: DB.pos.metas_personalizadas.filter(delPeriodo) };
  }));

  app.post("/api/metas/okr", requiereLogin, admin, (req, res) => responder(res, () => M.crearOkr(DB, req.body || {}, req.usuarioToken)));
  app.post("/api/metas/okr/:clave/editar", requiereLogin, admin, (req, res) => responder(res, () =>
    M.editarOkr(DB, idDeObjetivos(req.params.clave, "clave"), req.body || {}, req.usuarioToken)));
  app.post("/api/metas/okr/:clave/retirar", requiereLogin, admin, (req, res) => responder(res, () =>
    M.retirarOkr(DB, idDeObjetivos(req.params.clave, "clave"), req.body?.motivo, req.usuarioToken)));

  app.post("/api/metas", requiereLogin, admin, (req, res) => responder(res, () => M.crearMeta(DB, req.body || {}, req.usuarioToken)));
  app.post("/api/metas/:clave/editar", requiereLogin, admin, (req, res) => responder(res, () =>
    M.editarMeta(DB, idDeObjetivos(req.params.clave, "clave"), req.body || {}, req.usuarioToken)));
  app.post("/api/metas/:clave/retirar", requiereLogin, admin, (req, res) => responder(res, () =>
    M.retirarMeta(DB, idDeObjetivos(req.params.clave, "clave"), req.body?.motivo, req.usuarioToken)));
  app.get("/api/metas/:clave/historial", requiereLogin, admin, (req, res) => responder(res, () =>
    M.historial(DB, "metas_personalizadas", idDeObjetivos(req.params.clave, "clave"))));

  app.post("/api/metas/:clave/captura", requiereLogin, permiso("usar_gerente_ventas"), async (req, res) => {
    try {
      const clave = idDeObjetivos(req.params.clave, "clave");
      const meta = M.metaVigente(DB, clave);
      const captura = await capturarMeta(DB, clave, req.body || {}, {
        usuario: req.usuarioToken, vendedor_id: vendedorLigadoAObjetivos(req), drive,
        antesDeGuardar: () => { if (meta && M.periodoSellado(DB, meta.periodo, meta.inicio)) throw new Error("El periodo ya está sellado; no se puede capturar"); },
      });
      res.json(capturaParaRespuesta(captura));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.post("/api/metas/captura/:id/anular", requiereLogin, permiso("usar_gerente_ventas"), (req, res) => {
    try {
      const id = idDeObjetivos(req.params.id, "id");
      const captura = DB.pos.meta_capturas.find((c) => c.id === id);
      const propia = captura && captura.vendedor_id === vendedorLigadoAObjetivos(req);
      const jefatura = captura && tiene(req, "anular_capturas_metas") && capturaEnAlcance(req, captura);
      if (!captura || (!propia && !jefatura)) return res.status(404).json({ error: "Captura no encontrada" });
      res.json(capturaParaRespuesta(anularCaptura(DB, id, req.body?.motivo, req.usuarioToken)));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.get("/api/metas/revision", requiereLogin, permiso("anular_capturas_metas"), (req, res) => responder(res, () =>
    DB.pos.meta_capturas
      .filter((c) => c.periodo === req.query.periodo && c.inicio === req.query.inicio && capturaEnAlcance(req, c))
      .map((c) => ({ ...capturaParaRespuesta(c),
        vendedor_nombre: DB.pos.vendedores.find((v) => v.id === c.vendedor_id)?.nombre || "desconocido",
        meta_nombre: M.historial(DB, "metas_personalizadas", c.meta_clave).at(-1)?.nombre || "desconocida" }))));

  app.get("/api/metas/sello/previo", requiereLogin, admin, (req, res) => responder(res, () =>
    previoSello(DB, { periodo: req.query.periodo, inicio: req.query.inicio }, hoy())));
  app.post("/api/metas/sello", requiereLogin, admin, (req, res) => responder(res, () =>
    sellarPeriodo(DB, { periodo: req.body?.periodo, inicio: req.body?.inicio }, req.usuarioToken, hoy())));
  app.post("/api/metas/sello/:id/rectificar", requiereLogin, admin, (req, res) => responder(res, () =>
    rectificarSello(DB, idDeObjetivos(req.params.id, "id"), req.body || {}, req.usuarioToken)));
};
```

En `server.js`, después de la ruta `/api/objetivos/cierre/:id/rectificar`:

```js
// Metas personalizadas (KPIs/OKRs). Ver metasRutas.js.
require("./metasRutas")(app, {
  DB, drive, requiereLogin, requierePermiso, resolverPermisosDeRol, resolverAlcanceAutorizado, vendedorLigadoAObjetivos, idDeObjetivos,
});
```

Verificar que `requierePermiso` es la función que ya usan las rutas de objetivos (misma firma `requierePermiso(clave, resolverPermisosDeRol)`) y que las rutas con `:clave` no chocan con `/api/metas/tablero`, `/admin`, `/revision`, `/sello/...` (las rutas literales están registradas ANTES de `/:clave/...` o usan otro método; `GET /api/metas/:clave/historial` no choca con `GET /api/metas/tablero` porque tiene dos segmentos).

- [ ] **Step 4:** `node --preserve-symlinks --preserve-symlinks-main --test metasRutas.test.js` → PASS; y los 6 archivos de metas en verde.
- [ ] **Step 5: Commit** (Claude): `feat(metas): rutas de metas personalizadas`

---

## Verificación final (Claude)

- Suite completa backend (base 2597 + Entrega 0.5 + estas) y `src` en verde; build de Vite.
- `grep -rn "Ã" backend/metas*.js` vacío (mojibake).
- Prueba manual por API en copia local: crear OKR "Videos Palenque" con 2 metas, capturar como vendedora con liga de TikTok, liga repetida rechazada, gerente anula, sellar semana pasada, rectificar.
- Producción (anotar para el merge): el rol Gerente ya guardado NO recibe `anular_capturas_metas` solo; Victor lo asigna en Roles y Personal. El Administrador sí se reconcilia solo.
