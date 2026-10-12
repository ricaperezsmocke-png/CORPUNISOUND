# Planeador con IA para metas extra — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un botón en Administrar metas extra que pide a Claude un borrador de OKR + 3–6 metas, y que solo crea lo que un usuario con permiso aceptó punto por punto.

**Architecture:** Cuatro módulos de backend con una responsabilidad cada uno (datos agregados → validación de la respuesta → llamada y registro → validación humana y creación todo-o-nada), cuatro rutas nuevas en `metasRutas.js`, y una ventana React de 3 pasos con su lógica pura aparte. La creación reutiliza `crearOkr`/`crearMeta`, así que todas las reglas del alta normal aplican.

**Tech Stack:** Node/Express + DB en memoria persistida en SQLite (`guardar(DB)` automático tras POST con status < 400), `@anthropic-ai/sdk` ya instalado, React 18 + Vite + Tailwind, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-12-planeador-ia-metas-design.md` (aprobado por Victor 2026-10-12). Léelo antes de empezar.

## Global Constraints

- Worktree `.claude/worktrees/planeador-ia`, rama `feature/planeador-ia`, base `0cb97f9` (producción). Si HEAD no es `0cb97f9` al empezar o hay cambios sin commitear en `src/` o `backend/`, detente y reporta.
- Sin dependencias nuevas. Sin `git add .` (staging por rutas). Mensajes de commit sin acentos. Nada de merge/push.
- Líneas ≤ 200 caracteres en `src/` y `backend/`. UTF-8 correcto: ningún "Ã" en lo que toques.
- Permiso único: `administrar_metas_personalizadas` (ya existe). No se crea permiso nuevo.
- A la IA nunca van nombres de personal, clientes, teléfonos, costos, márgenes, ventas individuales ni ids de usuario.
- Modelo `claude-opus-5-5`, timeout 30 000 ms con AbortController, límite 20 propuestas por usuario por día (fecha local `fechaLocal`).
- Respuesta estructurada con herramienta forzada (`tools` + `tool_choice: { type: "tool" }`), como `backend/facturaIA.js`. Por eso NO se manda `output_config`/thinking (con herramienta forzada no aplica); sin `temperature`.
- Textos de pantalla en español, con acentos.
- Pruebas (equipo de 8 GB, de una en una, nunca la suite completa del backend), con `NODE_OPTIONS="--preserve-symlinks --preserve-symlinks-main"`:
  - backend: `cd backend && node --test <archivos>`
  - frontend: `node --test src`
  - `npx eslint src backend` (0 errores) y `npm run build` (termina en "built in").

## Review Focus

1. Doble clic en "Confirmar": la segunda petición debe recibir 400 y no crear duplicados (Task 5, prueba "segunda validacion").
2. Periodo sellado entre la propuesta y la validación: 400 y cero metas/OKR creados (Task 5, prueba "todo o nada").
3. Texto del objetivo con nombre de una vendedora en minúsculas y sin acento ("ana lopez"): no debe llegar a la IA (Task 1, prueba "quitarNombres").
4. Respuesta de la IA con cifra disparatada (p. ej. 500 publicaciones cuando el máximo mensual fue 10): plan rechazado, nada guardado como borrador (Task 2, prueba "tope").
5. "Toda la empresa" sin vendedoras activas: error claro al validar, no OKR vacío de participantes (Task 5, prueba "empresa sin participantes").

---

## Archivos

| Archivo | Responsabilidad |
|---|---|
| `backend/planIADatos.js` (nuevo) | Arma los datos agregados, el catálogo de acciones, los máximos históricos y quita nombres del texto |
| `backend/planIAValidar.js` (nuevo) | Valida la respuesta de la IA contra las reglas de la sección 5 del spec |
| `backend/planIA.js` (nuevo) | Llama a la IA con timeout y límite diario; registra el intento en `DB.pos.planes_ia` |
| `backend/planIACrear.js` (nuevo) | Valida las decisiones humanas y crea lo aceptado, todo o nada; descartar; listar |
| `backend/metasPersonalizadas.js` | `crearOkr`/`crearMeta` aceptan `{ origen }` |
| `backend/metasRutas.js` | 4 rutas nuevas |
| `backend/server.js` | colección `planes_ia`, dependencia `clienteIA` |
| `src/metas/planIA.js` (nuevo) | Lógica pura de la ventana: estado, decisiones, cuerpo, resumen |
| `src/metas/PlaneadorIA.jsx` (nuevo) | Ventana de 3 pasos |
| `src/metas/PlanesIA.jsx` (nuevo) | Lista "Planes con IA" (propuesto contra aprobado) |
| `src/metas/AdministrarMetas.jsx` | Botones, y "Origen: plan con IA" en el historial |

---

### Task 0: Preparar el worktree

- [ ] **Step 1: Verificar base y crear worktree** (desde `C:/Users/Victor/Desktop/CORPUNISOUND`)

```bash
git status --short src backend   # debe salir vacío
git log --oneline -1             # 0cb97f9 Merge branch 'fix/objetivos-fase1'
git worktree add .claude/worktrees/planeador-ia -b feature/planeador-ia 0cb97f9
robocopy node_modules .claude/worktrees/planeador-ia/node_modules /E /NFL /NDL /NJH /NJS
robocopy backend/node_modules .claude/worktrees/planeador-ia/backend/node_modules /E /NFL /NDL /NJH /NJS
cp backend/.env backend/datos.sqlite .claude/worktrees/planeador-ia/backend/
```

- [ ] **Step 2: Línea base de pruebas** (en el worktree)

```bash
cd backend && node --test metasPersonalizadas.test.js metasRutas.test.js && cd ..
node --test src
```
Expected: todo en verde; anota los conteos para comparar al final.

---

### Task 1: Datos que se mandan a la IA (`planIADatos.js`)

**Files:**
- Create: `backend/planIADatos.js`
- Test: `backend/planIADatos.test.js`

**Interfaces:**
- Produces:
  - `armarDatosPlan(DB, { sucursal_id: number|null, periodo, inicio }, hoy: "AAAA-MM-DD") → { datos, catalogo, maximos, cifrasPermitidas: number[], sinHistorial: boolean }`
    - `catalogo: [{ accion: string, nombre, unidad, prueba }]`, `accion` = `"actividad:<clave>"` o `"meta:<nombre>"`
    - `maximos: { [accion]: number }` (máximo MENSUAL histórico; 0 si nunca hubo)
  - `quitarNombres(DB, texto) → string`
  - `FACTOR_PERIODO = { semanal: 0.25, mensual: 1, trimestral: 3 }`

- [ ] **Step 1: Write the failing test**

```js
// backend/planIADatos.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { armarDatosPlan, quitarNombres, FACTOR_PERIODO } = require("./planIADatos");

const HOY = "2026-10-12";
function dbFalso() {
  return {
    admin: { usuarios: [{ id: 9, nombre: "Rosa Pérez", usuario: "rosa" }] },
    pos: {
      sucursales: [{ id: 1, nombre: "Ocosingo" }, { id: 2, nombre: "Palenque" }],
      vendedores: [
        { id: 1, nombre: "Ana López", sucursal_id: 1, activo: true },
        { id: 2, nombre: "Carlos Ruiz", sucursal_id: 1, activo: false },
        { id: 3, nombre: "María Díaz", sucursal_id: 2 },
      ],
      ventas: [
        { id: 1, fecha: "2026-09-10", sucursal_id: 1, vendedor_id: 1, estatus: "cerrada", total: 1500, cliente_nombre: "Juan Cliente",
          cliente_telefono: "9191234567", costo_total: 900 },
        { id: 2, fecha: "2026-08-02", sucursal_id: 1, vendedor_id: 1, estatus: "cerrada", total: 2000 },
        { id: 3, fecha: "2026-09-01", sucursal_id: 2, vendedor_id: 3, estatus: "cerrada", total: 999 },
        { id: 4, fecha: "2026-09-11", sucursal_id: 1, vendedor_id: 1, estatus: "cancelada", total: 5000 },
        { id: 5, fecha: "2026-10-05", sucursal_id: 1, vendedor_id: 1, estatus: "cerrada", total: 700 },
      ],
      objetivos: [{ id: 1, tipo: "venta", mes: "2026-10", sucursal_id: 1, vendedor_id: null, actividad: null, marca_id: null,
        producto_meta_id: null, financiera: null, monto: 50000, vigente: true }],
      objetivo_actividades: [
        { id: 1, mes: "2026-09", sucursal_id: 1, actividad: "grupos", vigente: true },
        { id: 2, mes: "2026-09", sucursal_id: 1, actividad: "grupos", vigente: true },
        { id: 3, mes: "2026-09", sucursal_id: 1, actividad: "grupos", vigente: false },
        { id: 4, mes: "2026-08", sucursal_id: 1, actividad: "iglesia", vigente: true },
      ],
      metas_personalizadas: [{ id: 1, clave: 1, vigente: true, nombre: "Videos de tips", unidad: "videos", prueba: "liga",
        valor_meta: 4, periodo: "semanal", inicio: "2026-09-07", alcance: "tienda", sucursal_id: 1 }],
      meta_capturas: [
        { id: 1, meta_clave: 1, sucursal_id: 1, cantidad: 3, anulada: null },
        { id: 2, meta_clave: 1, sucursal_id: 1, cantidad: 2, anulada: { motivo: "x" } },
      ],
      objetivo_marcas: [{ id: 1, nombre: "Yamaha", activo: true }, { id: 2, nombre: "Vieja", activo: false }],
    },
  };
}

test("armarDatosPlan: solo cifras agregadas de la tienda, sin nombres, clientes, telefonos ni costos", () => {
  const { datos } = armarDatosPlan(dbFalso(), { sucursal_id: 1, periodo: "mensual", inicio: "2026-11-01" }, HOY);
  const texto = JSON.stringify(datos);
  for (const prohibido of ["Ana", "Carlos", "Rosa", "Juan", "9191234567", "900", "vendedor_id", "costo"]) {
    assert.ok(!texto.includes(prohibido), `no debe aparecer ${prohibido}`);
  }
  assert.equal(datos.tienda, "Ocosingo");
  assert.deepEqual(datos.venta_por_mes.map((m) => m.mes), ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
  assert.equal(datos.venta_por_mes.find((m) => m.mes === "2026-09").venta, 1500); // ni cancelada ni otra tienda
  assert.deepEqual(datos.venta_mes_actual, { mes: "2026-10", meta: 50000, vendido_hasta_hoy: 700 });
  assert.equal(datos.personas_activas, 1);
  assert.equal(datos.actividades_por_mes.find((m) => m.mes === "2026-09").grupos, 2); // la anulada no cuenta
  assert.deepEqual(datos.metas_anteriores, [{ nombre: "Videos de tips", unidad: "videos", periodo: "semanal", valor_meta: 4, resultado: 3 }]);
  assert.deepEqual(datos.marcas, ["Yamaha"]);
});

test("armarDatosPlan: catalogo y maximos mensuales por accion", () => {
  const { catalogo, maximos, sinHistorial } = armarDatosPlan(dbFalso(), { sucursal_id: 1, periodo: "mensual", inicio: "2026-11-01" }, HOY);
  assert.ok(catalogo.some((c) => c.accion === "actividad:grupos" && c.prueba === "liga"));
  assert.ok(catalogo.some((c) => c.accion === "actividad:iglesia" && c.prueba === "foto"));
  assert.ok(catalogo.some((c) => c.accion === "meta:Videos de tips" && c.unidad === "videos"));
  assert.equal(maximos["actividad:grupos"], 2);
  assert.equal(maximos["actividad:volanteo"], 0);
  assert.equal(maximos["meta:Videos de tips"], 12); // 3 en una semana = 12 al mes
  assert.equal(sinHistorial, false);
});

test("armarDatosPlan: toda la empresa suma tiendas; tienda sin historial se marca", () => {
  const db = dbFalso();
  const { datos } = armarDatosPlan(db, { sucursal_id: null, periodo: "mensual", inicio: "2026-11-01" }, HOY);
  assert.equal(datos.tienda, "toda la empresa");
  assert.equal(datos.venta_por_mes.find((m) => m.mes === "2026-09").venta, 2499);
  db.pos.sucursales.push({ id: 7, nombre: "Innotec" });
  assert.equal(armarDatosPlan(db, { sucursal_id: 7, periodo: "mensual", inicio: "2026-11-01" }, HOY).sinHistorial, true);
});

test("armarDatosPlan: cifrasPermitidas trae los numeros enviados", () => {
  const { cifrasPermitidas } = armarDatosPlan(dbFalso(), { sucursal_id: 1, periodo: "mensual", inicio: "2026-11-01" }, HOY);
  for (const n of [1500, 2000, 50000, 700, 2, 3, 4]) assert.ok(cifrasPermitidas.includes(n), `falta ${n}`);
});

test("quitarNombres: cambia nombres de personal y usuarios sin importar acentos ni mayusculas", () => {
  const texto = quitarNombres(dbFalso(), "Que ana lopez y ROSA vendan más guitarras; María también");
  assert.equal(texto, "Que [persona] [persona] y [persona] vendan más guitarras; [persona] también");
});

test("FACTOR_PERIODO convierte a escala mensual", () => {
  assert.deepEqual(FACTOR_PERIODO, { semanal: 0.25, mensual: 1, trimestral: 3 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test planIADatos.test.js`
Expected: FAIL con "Cannot find module './planIADatos'".

- [ ] **Step 3: Write minimal implementation**

```js
// backend/planIADatos.js
// Datos que se le mandan a la IA para proponer un plan de metas extra. SOLO cifras agregadas de la tienda:
// nunca nombres, clientes, teléfonos, costos ni ventas individuales (decisión de Victor 2026-08-16).
const { CLASES_ACTIVIDAD } = require("./objetivosActividadesCatalogo");
const { objetivoVigente } = require("./objetivos");
const { listarElementos } = require("./objetivosCatalogos");
const { estaActivo } = require("./vendedores");

const MESES_HISTORIAL = 6;
// Para comparar una cifra semanal o trimestral contra el historial mensual.
const FACTOR_PERIODO = { semanal: 0.25, mensual: 1, trimestral: 3 };
const PRUEBA_DE_EVIDENCIA = { link: "liga", foto: "foto" };

function mesesAnteriores(hoy, cuantos) {
  const [anio, mes] = hoy.split("-").map(Number);
  return Array.from({ length: cuantos }, (_, i) => new Date(Date.UTC(anio, mes - 2 - i, 1)).toISOString().slice(0, 7)).reverse();
}

const comparable = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function armarDatosPlan(DB, { sucursal_id, periodo, inicio }, hoy) {
  const deTienda = (r) => sucursal_id === null || Number(r.sucursal_id) === sucursal_id;
  const meses = mesesAnteriores(hoy, MESES_HISTORIAL);
  const mesActual = hoy.slice(0, 7);
  const ventasCerradas = DB.pos.ventas.filter((v) => v.estatus === "cerrada" && deTienda(v));
  const ventaDe = (mes, hasta = "9999-12-31") => Math.round(ventasCerradas
    .filter((v) => String(v.fecha || "").slice(0, 7) === mes && String(v.fecha).slice(0, 10) <= hasta)
    .reduce((suma, v) => suma + Number(v.total || 0), 0));
  const tiendas = sucursal_id === null ? DB.pos.sucursales.map((s) => s.id) : [sucursal_id];
  const metaVenta = tiendas.reduce((suma, id) =>
    suma + (objetivoVigente(DB, { tipo: "venta", mes: mesActual, sucursal_id: id, vendedor_id: null })?.monto ?? 0), 0);

  const actividades = (DB.pos.objetivo_actividades || []).filter((a) => a.vigente && deTienda(a));
  const actividades_por_mes = meses.map((mes) => Object.fromEntries([["mes", mes],
    ...CLASES_ACTIVIDAD.map((c) => [c.clave, actividades.filter((a) => a.mes === mes && a.actividad === c.clave).length])]));

  const capturas = DB.pos.meta_capturas.filter((c) => !c.anulada && deTienda(c));
  const metas_anteriores = DB.pos.metas_personalizadas
    .filter((m) => m.vigente && m.inicio < inicio && (sucursal_id === null || m.sucursal_id === sucursal_id))
    .sort((a, b) => b.inicio.localeCompare(a.inicio)).slice(0, 20)
    .map((m) => ({ nombre: m.nombre, unidad: m.unidad, periodo: m.periodo, valor_meta: m.valor_meta,
      resultado: capturas.filter((c) => c.meta_clave === m.clave).reduce((suma, c) => suma + Number(c.cantidad || 0), 0) }));

  const tienda = sucursal_id === null ? "toda la empresa" : DB.pos.sucursales.find((s) => s.id === sucursal_id)?.nombre || "tienda";
  const datos = {
    tienda, periodo, inicio,
    venta_por_mes: meses.map((mes) => ({ mes, venta: ventaDe(mes) })),
    venta_mes_actual: { mes: mesActual, meta: metaVenta, vendido_hasta_hoy: ventaDe(mesActual, hoy) },
    personas_activas: DB.pos.vendedores.filter((v) => estaActivo(v) && deTienda(v)).length,
    actividades_por_mes, metas_anteriores,
    marcas: listarElementos(DB, "marcas").map((e) => e.nombre).slice(0, 60),
  };

  const catalogo = CLASES_ACTIVIDAD.map((c) => ({ accion: `actividad:${c.clave}`, nombre: c.etiqueta, unidad: c.unidad,
    prueba: PRUEBA_DE_EVIDENCIA[c.evidencia] }));
  const maximos = Object.fromEntries(CLASES_ACTIVIDAD.map((c) =>
    [`actividad:${c.clave}`, Math.max(0, ...actividades_por_mes.map((m) => m[c.clave]))]));
  for (const m of metas_anteriores) {
    const accion = `meta:${m.nombre}`;
    if (!catalogo.some((c) => c.accion === accion)) catalogo.push({ accion, nombre: m.nombre, unidad: m.unidad, prueba: "ninguna" });
    maximos[accion] = Math.max(maximos[accion] || 0, Math.round(m.resultado / FACTOR_PERIODO[m.periodo]));
  }
  for (const c of catalogo) {
    const original = DB.pos.metas_personalizadas.find((m) => `meta:${m.nombre}` === c.accion);
    if (original) c.prueba = original.prueba;
  }

  const sinHistorial = datos.venta_por_mes.every((m) => m.venta === 0) && actividades.length === 0 && metas_anteriores.length === 0;
  return { datos, catalogo, maximos, cifrasPermitidas: numerosDe(datos), sinHistorial };
}

function numerosDe(valor, lista = []) {
  if (typeof valor === "number" && Number.isFinite(valor)) lista.push(valor);
  else if (valor && typeof valor === "object") Object.values(valor).forEach((v) => numerosDe(v, lista));
  return lista;
}

// Cambia por "[persona]" cada palabra del texto que coincida con una palabra de un nombre de personal o de usuario.
function quitarNombres(DB, texto) {
  const nombres = [...DB.pos.vendedores, ...(DB.admin?.usuarios || [])].flatMap((p) => [p.nombre, p.usuario])
    .filter(Boolean).flatMap((n) => comparable(n).match(/\p{L}+/gu) || []).filter((palabra) => palabra.length >= 3);
  const prohibidas = new Set(nombres);
  return texto.replace(/\p{L}+/gu, (palabra) => (prohibidas.has(comparable(palabra)) ? "[persona]" : palabra));
}

module.exports = { armarDatosPlan, quitarNombres, FACTOR_PERIODO };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test planIADatos.test.js`
Expected: PASS (6 pruebas).

- [ ] **Step 5: Commit**

```bash
git add backend/planIADatos.js backend/planIADatos.test.js
git commit -m "feat(planeador-ia): datos agregados para la IA sin nombres ni costos"
```

---

### Task 2: Validar la respuesta de la IA (`planIAValidar.js`)

**Files:**
- Create: `backend/planIAValidar.js`
- Test: `backend/planIAValidar.test.js`

**Interfaces:**
- Consumes: `FACTOR_PERIODO` de `./planIADatos`; `PRUEBAS` de `./metasPersonalizadas`.
- Produces: `validarPropuesta(propuesta, { catalogo, maximos, periodo, cifrasPermitidas }) → { okr: { titulo, descripcion }, metas: [{ indice, accion, nueva, nombre, unidad, prueba, valor_meta, tope, sin_historico, por_que }] }`; lanza `Error` con `e.planInvalido = true` si no cumple. `TEXTO_POR_QUE` exportado.

- [ ] **Step 1: Write the failing test**

```js
// backend/planIAValidar.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validarPropuesta, TEXTO_POR_QUE } = require("./planIAValidar");

const CONTEXTO = {
  periodo: "mensual",
  catalogo: [
    { accion: "actividad:grupos", nombre: "Publicación en grupos", unidad: "publicación", prueba: "liga" },
    { accion: "actividad:iglesia", nombre: "Salida a iglesia", unidad: "salida", prueba: "foto" },
    { accion: "actividad:volanteo", nombre: "Jornada de volanteo", unidad: "jornada", prueba: "foto" },
  ],
  maximos: { "actividad:grupos": 10, "actividad:iglesia": 2, "actividad:volanteo": 0 },
  cifrasPermitidas: [10, 2, 1500],
};
const meta = (extra = {}) => ({ accion: "actividad:grupos", nombre: "Publicar en grupos", unidad: "publicaciones", prueba: "liga",
  valor_meta: 12, por_que: "El mejor mes tuvo 10 publicaciones", ...extra });
const propuesta = (metas) => ({ okr: { titulo: "Vender más acústicas", descripcion: "Mover el inventario" }, metas });
const falla = (p, texto) => assert.throws(() => validarPropuesta(p, CONTEXTO), (e) => e.planInvalido && e.message.includes(texto));

test("propuesta correcta pasa y conserva indices", () => {
  const r = validarPropuesta(propuesta([meta(), meta({ accion: "actividad:iglesia", valor_meta: 3, prueba: "foto", por_que: "" }),
    meta({ accion: "nueva", nombre: "Clínica de guitarra", valor_meta: 1, prueba: "foto", por_que: "Idea" })]), CONTEXTO);
  assert.equal(r.okr.titulo, "Vender más acústicas");
  assert.deepEqual(r.metas.map((m) => m.indice), [0, 1, 2]);
  assert.equal(r.metas[0].por_que, "El mejor mes tuvo 10 publicaciones");
  assert.equal(r.metas[1].por_que, TEXTO_POR_QUE); // vacío
  assert.equal(r.metas[2].nueva, true);
  assert.equal(r.metas[2].sin_historico, true);
});

test("cantidad de metas: menos de 3 o mas de 6 se rechaza", () => {
  falla(propuesta([meta(), meta()]), "de 3 a 6");
  falla(propuesta(Array.from({ length: 7 }, () => meta())), "de 3 a 6");
});

test("mas de 2 ideas nuevas se rechaza", () => {
  const nueva = meta({ accion: "nueva" });
  falla(propuesta([nueva, nueva, nueva]), "más de 2 ideas nuevas");
});

test("accion fuera del catalogo se rechaza", () => falla(propuesta([meta(), meta(), meta({ accion: "actividad:tiktok" })]), "fuera del catálogo"));

test("prueba, cifra y textos invalidos se rechazan", () => {
  falla(propuesta([meta(), meta(), meta({ prueba: "video" })]), "prueba");
  falla(propuesta([meta(), meta(), meta({ valor_meta: 2.5 })]), "cifra");
  falla(propuesta([meta(), meta(), meta({ valor_meta: 0 })]), "cifra");
  falla(propuesta([meta(), meta(), meta({ nombre: "" })]), "nombre");
  falla({ okr: { titulo: "x".repeat(121) }, metas: [meta(), meta(), meta()] }, "OKR");
  falla(null, "sin contenido");
});

test("tope: mas de 3 veces el maximo mensual se rechaza; sin historico se acepta y se marca", () => {
  falla(propuesta([meta(), meta(), meta({ valor_meta: 31 })]), "pasa de 30");
  const r = validarPropuesta(propuesta([meta({ valor_meta: 30 }), meta(), meta({ accion: "actividad:volanteo", valor_meta: 50 })]), CONTEXTO);
  assert.equal(r.metas[0].tope, 30);
  assert.equal(r.metas[2].sin_historico, true);
  const semanal = { ...CONTEXTO, periodo: "semanal" };
  assert.throws(() => validarPropuesta(propuesta([meta({ valor_meta: 9 }), meta({ valor_meta: 1 }), meta({ valor_meta: 1 })]), semanal),
    /pasa de 8/);
});

test("por que con un numero inventado se sustituye por el texto del sistema", () => {
  const r = validarPropuesta(propuesta([meta({ por_que: "Las tiendas similares hacen 45 por mes" }), meta(), meta()]), CONTEXTO);
  assert.equal(r.metas[0].por_que, TEXTO_POR_QUE);
  const ok = validarPropuesta(propuesta([meta({ por_que: "Vendiste $1,500 y propongo 12" }), meta(), meta()]), CONTEXTO);
  assert.equal(ok.metas[0].por_que, "Vendiste $1,500 y propongo 12");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test planIAValidar.test.js`
Expected: FAIL con "Cannot find module './planIAValidar'".

- [ ] **Step 3: Write minimal implementation**

```js
// backend/planIAValidar.js
// Lo que responde la IA se revisa aquí ANTES de mostrarlo. Si algo no cumple, el plan entero se rechaza:
// no se "arregla" a medias (spec 2026-10-12, sección 5).
const { FACTOR_PERIODO } = require("./planIADatos");
const { PRUEBAS } = require("./metasPersonalizadas");

const MIN_METAS = 3;
const MAX_METAS = 6;
const MAX_NUEVAS = 2;
const TOPE_HISTORICO = 3;
const TEXTO_POR_QUE = "Propuesta basada en el historial de la tienda";

const textoValido = (v, maximo) => typeof v === "string" && v.trim().length > 0 && v.trim().length <= maximo;
const numerosEn = (texto) => (texto.match(/\d[\d,]*(?:\.\d+)?/g) || []).map((s) => Number(s.replace(/,/g, "")));

function falla(motivo) {
  const error = new Error(`La IA devolvió un plan inválido: ${motivo}`);
  error.planInvalido = true;
  throw error;
}

function validarPropuesta(propuesta, { catalogo, maximos, periodo, cifrasPermitidas }) {
  if (!propuesta || typeof propuesta !== "object") falla("sin contenido");
  const { okr, metas } = propuesta;
  if (!okr || !textoValido(okr.titulo, 120)) falla("el OKR necesita un título de hasta 120 caracteres");
  if (okr.descripcion != null && (typeof okr.descripcion !== "string" || okr.descripcion.length > 500)) falla("descripción del OKR");
  if (!Array.isArray(metas) || metas.length < MIN_METAS || metas.length > MAX_METAS) falla("debe traer de 3 a 6 metas");
  if (metas.filter((m) => m?.accion === "nueva").length > MAX_NUEVAS) falla("trae más de 2 ideas nuevas");

  const acciones = new Set(catalogo.map((c) => c.accion));
  const permitidas = new Set([...cifrasPermitidas, ...metas.map((m) => m?.valor_meta)]);
  const limpias = metas.map((m, indice) => {
    const n = indice + 1;
    if (!m || !textoValido(m.nombre, 120) || !textoValido(m.unidad, 40)) falla(`la meta ${n} no tiene nombre o unidad válidos`);
    if (!PRUEBAS.includes(m.prueba)) falla(`la prueba de la meta ${n} debe ser ninguna, liga o foto`);
    if (!Number.isInteger(m.valor_meta) || m.valor_meta < 1) falla(`la cifra de la meta ${n} debe ser un entero mayor que 0`);
    const nueva = m.accion === "nueva";
    if (!nueva && !acciones.has(m.accion)) falla(`la meta ${n} usa una acción fuera del catálogo`);
    const maximo = nueva ? 0 : maximos[m.accion] || 0;
    const tope = maximo > 0 ? Math.ceil(TOPE_HISTORICO * maximo * FACTOR_PERIODO[periodo]) : null;
    if (tope !== null && m.valor_meta > tope) falla(`la cifra de la meta ${n} pasa de ${tope}`);
    const porQue = textoValido(m.por_que, 200) && numerosEn(m.por_que).every((x) => permitidas.has(x)) ? m.por_que.trim() : TEXTO_POR_QUE;
    return { indice, accion: m.accion, nueva, nombre: m.nombre.trim(), unidad: m.unidad.trim(), prueba: m.prueba,
      valor_meta: m.valor_meta, tope, sin_historico: tope === null, por_que: porQue };
  });
  return { okr: { titulo: okr.titulo.trim(), descripcion: okr.descripcion?.trim() || null }, metas: limpias };
}

module.exports = { validarPropuesta, TEXTO_POR_QUE, MIN_METAS, MAX_METAS, MAX_NUEVAS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test planIAValidar.test.js`
Expected: PASS (7 pruebas).

- [ ] **Step 5: Commit**

```bash
git add backend/planIAValidar.js backend/planIAValidar.test.js
git commit -m "feat(planeador-ia): validar la propuesta de la IA antes de mostrarla"
```

---

### Task 3: Origen en OKR y metas, y colección `planes_ia`

**Files:**
- Modify: `backend/metasPersonalizadas.js` (`crearOkr` ~línea 94, `crearMeta` ~línea 132)
- Modify: `backend/server.js` (~línea 203 valores por defecto; ~línea 377 normalización)
- Test: `backend/metasPersonalizadas.test.js` (agregar al final)

**Interfaces:**
- Produces: `crearOkr(DB, datos, usuario, { origen } = {})` y `crearMeta(DB, datos, usuario, { origen } = {})`; ambos guardan `origen` (`null` por omisión). `DB.pos.planes_ia` siempre es arreglo.

- [ ] **Step 1: Write the failing test** (al final de `backend/metasPersonalizadas.test.js`; reutiliza el DB de prueba y el periodo que ya usa ese archivo — revisa su encabezado y usa sus mismas variables/funciones de armado; si arma el DB con una función, llámala igual)

```js
test("planeador ia: crearOkr y crearMeta guardan el origen; sin origen queda null", () => {
  const DB = dbDePrueba();
  const usuario = { id: 1, nombre: "Victor" };
  const origen = { tipo: "plan_ia", plan_id: 3, validado_por_nombre: "Victor", validado_en: "2026-10-12T18:00:00.000Z" };
  const okr = M.crearOkr(DB, { titulo: "Plan", periodo: PERIODO.periodo, inicio: PERIODO.inicio, alcance: "tienda", sucursal_id: 1 }, usuario,
    { origen });
  const meta = M.crearMeta(DB, { okr_clave: okr.clave, nombre: "Grupos", unidad: "pub", prueba: "liga", valor_meta: 5 }, usuario, { origen });
  const mano = M.crearMeta(DB, { okr_clave: okr.clave, nombre: "Otra", unidad: "pub", prueba: "liga", valor_meta: 5 }, usuario);
  assert.deepEqual(okr.origen, origen);
  assert.deepEqual(meta.origen, origen);
  assert.equal(mano.origen, null);
});
```
Si el archivo no tiene `dbDePrueba`/`PERIODO`/`M` con esos nombres, usa los equivalentes que ya define (no inventes otro armado).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test metasPersonalizadas.test.js`
Expected: FAIL en la prueba nueva (`okr.origen` es `undefined`).

- [ ] **Step 3: Implementación**

En `backend/metasPersonalizadas.js`:

```js
function crearOkr(DB, datos, usuario, { origen = null } = {}) {
  // ...sin cambios hasta construir el registro...
  const okr = { id, clave: id, version: 1, vigente: true, retirada: null, reemplaza_a: null, motivo: null,
    titulo, descripcion, periodo: datos.periodo, inicio: datos.inicio, ...alcance, origen, ...auditoria(usuario) };
```

```js
function crearMeta(DB, datos, usuario, { origen = null } = {}) {
  // ...sin cambios hasta construir el registro...
  const meta = { id, clave: id, version: 1, vigente: true, retirada: null, reemplaza_a: null, motivo: null,
    okr_clave, nombre, descripcion, unidad, prueba, valor_meta, periodo: base.periodo, inicio: base.inicio,
    ...alcance, origen, ...auditoria(usuario) };
```
(`nuevaVersion` copia `...anterior`, así que el origen sigue en las versiones editadas; es lo deseado.)

En `backend/server.js`, junto a `meta_sellos: [],` (~línea 203):

```js
    meta_sellos: [],
    // Borradores e intentos del planeador con IA. Ver planIA.js.
    planes_ia: [],
```
y junto a la normalización de `cajas` (~línea 377):

```js
if (!Array.isArray(DB.pos.planes_ia)) DB.pos.planes_ia = [];
```

- [ ] **Step 4: Run tests**

Run: `cd backend && node --test metasPersonalizadas.test.js metasRutas.test.js`
Expected: PASS (las que ya existían más la nueva).

- [ ] **Step 5: Commit**

```bash
git add backend/metasPersonalizadas.js backend/metasPersonalizadas.test.js backend/server.js
git commit -m "feat(planeador-ia): origen en okr y metas y coleccion planes_ia"
```

---

### Task 4: Pedir el plan a la IA y registrarlo (`planIA.js`)

**Files:**
- Create: `backend/planIA.js`
- Test: `backend/planIA.test.js`

**Interfaces:**
- Consumes: `armarDatosPlan`, `quitarNombres` (Task 1); `validarPropuesta` (Task 2); `periodoSellado` de `./metasPersonalizadas`; `validarPeriodo` de `./metasPeriodos`; `fechaLocal` de `./fechas`.
- Produces:
  - `proponerPlan(DB, cliente, entrada: { objetivo_texto, sucursal_id, periodo, inicio }, usuario, { hoy, timeoutMs = 30000 }) → Promise<plan>`
  - plan = `{ id, estado: "borrador"|"fallido", creado_por_id, creado_por_nombre, creado_en, entrada: { objetivo_texto, objetivo_enviado, sucursal_id, periodo, inicio }, sin_historial, propuesta, decisiones: [], validado_por_id: null, validado_por_nombre: null, validado_en: null, creados: null, error }`
  - Errores con `e.status`: 400 (entrada), 503 (sin cliente), 429 (límite), 502 (falla de IA, mensaje del spec).
  - `MENSAJE_FALLA`, `LIMITE_DIARIO = 20`, `MODELO = "claude-opus-5-5"`, `HERRAMIENTA`.

- [ ] **Step 1: Write the failing test**

```js
// backend/planIA.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { proponerPlan, MENSAJE_FALLA, LIMITE_DIARIO, MODELO } = require("./planIA");

const HOY = "2026-10-12";
const ENTRADA = { objetivo_texto: "Que Ana venda más guitarras acústicas", sucursal_id: 1, periodo: "mensual", inicio: "2026-11-01" };
const USUARIO = { id: 70, nombre: "Victor" };
const PROPUESTA = { okr: { titulo: "Más acústicas", descripcion: "" }, metas: [
  { accion: "actividad:grupos", nombre: "Publicar acústicas", unidad: "publicaciones", prueba: "liga", valor_meta: 3, por_que: "" },
  { accion: "actividad:iglesia", nombre: "Salidas", unidad: "salidas", prueba: "foto", valor_meta: 1, por_que: "" },
  { accion: "nueva", nombre: "Clínica", unidad: "clínica", prueba: "foto", valor_meta: 1, por_que: "" }] };

function dbMinimo() {
  return { admin: { usuarios: [] }, pos: {
    sucursales: [{ id: 1, nombre: "Ocosingo" }], vendedores: [{ id: 1, nombre: "Ana López", sucursal_id: 1 }],
    ventas: [], objetivos: [], objetivo_actividades: [{ id: 1, mes: "2026-09", sucursal_id: 1, actividad: "grupos", vigente: true },
      { id: 2, mes: "2026-08", sucursal_id: 1, actividad: "iglesia", vigente: true }],
    metas_personalizadas: [], meta_capturas: [], meta_sellos: [], objetivo_marcas: [], planes_ia: [],
  } };
}
function clienteFalso(respuesta, registro = []) {
  return { messages: { create: async (cuerpo, opciones) => {
    registro.push({ cuerpo, opciones });
    if (respuesta instanceof Error) throw respuesta;
    return { content: [{ type: "tool_use", name: "proponer_plan", input: respuesta }] };
  } } };
}

test("borrador: llama al modelo con herramienta forzada, sin nombres, y guarda el plan", async () => {
  const DB = dbMinimo();
  const llamadas = [];
  const plan = await proponerPlan(DB, clienteFalso(PROPUESTA, llamadas), ENTRADA, USUARIO, { hoy: HOY });
  assert.equal(plan.estado, "borrador");
  assert.equal(plan.propuesta.metas.length, 3);
  assert.equal(plan.entrada.objetivo_texto, ENTRADA.objetivo_texto);
  assert.equal(plan.entrada.objetivo_enviado, "Que [persona] venda más guitarras acústicas");
  assert.deepEqual(DB.pos.planes_ia, [plan]);
  const { cuerpo, opciones } = llamadas[0];
  assert.equal(cuerpo.model, MODELO);
  assert.deepEqual(cuerpo.tool_choice, { type: "tool", name: "proponer_plan" });
  assert.equal("temperature" in cuerpo, false);
  assert.ok(opciones.signal);
  assert.ok(!JSON.stringify(cuerpo.messages).includes("Ana"));
});

test("sin cliente configurado: 503 y nada guardado", async () => {
  const DB = dbMinimo();
  await assert.rejects(proponerPlan(DB, null, ENTRADA, USUARIO, { hoy: HOY }), (e) => e.status === 503);
  assert.equal(DB.pos.planes_ia.length, 0);
});

test("entrada invalida: 400 sin llamar a la IA", async () => {
  const DB = dbMinimo();
  const llamadas = [];
  const cliente = clienteFalso(PROPUESTA, llamadas);
  await assert.rejects(proponerPlan(DB, cliente, { ...ENTRADA, objetivo_texto: "  " }, USUARIO, { hoy: HOY }), (e) => e.status === 400);
  await assert.rejects(proponerPlan(DB, cliente, { ...ENTRADA, objetivo_texto: "x".repeat(501) }, USUARIO, { hoy: HOY }), (e) => e.status === 400);
  await assert.rejects(proponerPlan(DB, cliente, { ...ENTRADA, sucursal_id: 99 }, USUARIO, { hoy: HOY }), (e) => e.status === 400);
  DB.pos.meta_sellos.push({ periodo: "mensual", inicio: "2026-11-01" });
  await assert.rejects(proponerPlan(DB, cliente, ENTRADA, USUARIO, { hoy: HOY }), /sellado/);
  assert.equal(llamadas.length, 0);
});

test("falla de la IA, respuesta invalida o tiempo agotado: 502 con el mensaje, intento registrado como fallido", async () => {
  for (const cliente of [clienteFalso(new Error("caida")), clienteFalso({ okr: { titulo: "x" }, metas: [] }),
    { messages: { create: () => new Promise(() => {}) } }]) {
    const DB = dbMinimo();
    await assert.rejects(proponerPlan(DB, cliente, ENTRADA, USUARIO, { hoy: HOY, timeoutMs: 50 }),
      (e) => e.status === 502 && e.message === MENSAJE_FALLA);
    assert.equal(DB.pos.planes_ia.length, 1);
    assert.equal(DB.pos.planes_ia[0].estado, "fallido");
    assert.ok(DB.pos.planes_ia[0].error);
  }
});

test("limite diario: el intento 21 del mismo usuario el mismo dia recibe 429", async () => {
  const DB = dbMinimo();
  for (let i = 0; i < LIMITE_DIARIO; i++) {
    DB.pos.planes_ia.push({ id: i + 1, creado_por_id: 70, creado_en: "2026-10-12T15:00:00.000Z", estado: "fallido" });
  }
  DB.pos.planes_ia.push({ id: 99, creado_por_id: 71, creado_en: "2026-10-12T15:00:00.000Z", estado: "borrador" });
  await assert.rejects(proponerPlan(DB, clienteFalso(PROPUESTA), ENTRADA, USUARIO, { hoy: HOY }), (e) => e.status === 429);
  DB.pos.planes_ia.forEach((p) => { if (p.creado_por_id === 70) p.creado_en = "2026-10-11T15:00:00.000Z"; });
  assert.equal((await proponerPlan(DB, clienteFalso(PROPUESTA), ENTRADA, USUARIO, { hoy: HOY })).estado, "borrador");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test planIA.test.js`
Expected: FAIL con "Cannot find module './planIA'".

- [ ] **Step 3: Write minimal implementation**

```js
// backend/planIA.js
// Planeador con IA de metas extra. La IA SOLO escribe un borrador: aquí nada crea OKR ni metas.
// Lo que se crea lo decide una persona con permiso en planIACrear.js (regla de Victor 2026-10-12).
const { armarDatosPlan, quitarNombres } = require("./planIADatos");
const { validarPropuesta } = require("./planIAValidar");
const { periodoSellado } = require("./metasPersonalizadas");
const { validarPeriodo } = require("./metasPeriodos");
const { fechaLocal } = require("./fechas");

const MODELO = "claude-opus-5-5";
const MAX_TOKENS = 4096;
const TIMEOUT_MS = 30_000;
const LIMITE_DIARIO = 20;
const MENSAJE_FALLA = "No se pudo armar el plan; puedes intentarlo otra vez o dar de alta las metas a mano";

const META_SCHEMA = { type: "object", required: ["accion", "nombre", "unidad", "prueba", "valor_meta", "por_que"], properties: {
  accion: { type: "string", description: "Una 'accion' del catálogo, o 'nueva' si es una idea que no está en el catálogo" },
  nombre: { type: "string" }, unidad: { type: "string" }, prueba: { type: "string", enum: ["ninguna", "liga", "foto"] },
  valor_meta: { type: "integer", minimum: 1 }, por_que: { type: "string", description: "Una línea, máximo 200 caracteres" } } };
const HERRAMIENTA = {
  name: "proponer_plan",
  description: "Propone un OKR y de 3 a 6 metas medibles para el periodo.",
  input_schema: { type: "object", required: ["okr", "metas"], properties: {
    okr: { type: "object", required: ["titulo"], properties: { titulo: { type: "string" }, descripcion: { type: "string" } } },
    metas: { type: "array", minItems: 3, maxItems: 6, items: META_SCHEMA } } },
};

const INSTRUCCIONES = `Ayudas al dueño de una cadena de tiendas de instrumentos musicales en Chiapas, México, a planear metas del periodo.
Recibes su objetivo en palabras y un JSON con datos reales y agregados de la tienda. Propón un OKR y de 3 a 6 metas medibles.
Reglas que no puedes romper:
- Cada meta usa una "accion" del catálogo. Como máximo 2 metas pueden ser "nueva" (ideas fuera del catálogo).
- Las cifras son enteros alcanzables: no más de 3 veces lo mejor que la tienda ha hecho en esa acción, ajustado al periodo.
- En "por_que" no menciones ningún número que no esté en el JSON.
- No conoces a las personas y no inventes nombres.
Escribe en español de México, breve y concreto.`;

function errorCon(status, mensaje) {
  const error = new Error(mensaje);
  error.status = status;
  return error;
}

function leerEntrada(DB, entrada) {
  const texto = typeof entrada.objetivo_texto === "string" ? entrada.objetivo_texto.trim() : "";
  if (!texto || texto.length > 500) throw errorCon(400, "Escribe el objetivo (hasta 500 caracteres)");
  const sucursal_id = entrada.sucursal_id === null || entrada.sucursal_id === "" || entrada.sucursal_id === undefined
    ? null : Number(entrada.sucursal_id);
  if (sucursal_id !== null && !DB.pos.sucursales.some((s) => s.id === sucursal_id)) throw errorCon(400, "La tienda no existe");
  try { validarPeriodo(entrada.periodo, entrada.inicio); } catch (e) { throw errorCon(400, e.message); }
  if (periodoSellado(DB, entrada.periodo, entrada.inicio)) throw errorCon(400, "El periodo ya está sellado; no se le pueden crear metas");
  return { texto, sucursal_id, periodo: entrada.periodo, inicio: entrada.inicio };
}

const planesDeHoy = (DB, usuarioId, hoy) =>
  DB.pos.planes_ia.filter((p) => p.creado_por_id === usuarioId && fechaLocal(new Date(p.creado_en)) === hoy).length;

async function pedirAlModelo(cliente, contenido, timeoutMs) {
  const corte = new AbortController();
  let temporizador;
  try {
    const respuesta = await Promise.race([
      cliente.messages.create({
        model: MODELO, max_tokens: MAX_TOKENS, system: INSTRUCCIONES, tools: [HERRAMIENTA],
        tool_choice: { type: "tool", name: HERRAMIENTA.name },
        messages: [{ role: "user", content: JSON.stringify(contenido) }],
      }, { signal: corte.signal }),
      new Promise((_, rechazar) => { temporizador = setTimeout(() => { corte.abort(); rechazar(new Error("tiempo agotado")); }, timeoutMs); }),
    ]);
    const bloque = respuesta?.content?.find((b) => b.type === "tool_use" && b.name === HERRAMIENTA.name);
    if (!bloque) throw new Error("la IA no devolvió el plan");
    return bloque.input;
  } finally {
    clearTimeout(temporizador);
  }
}

async function proponerPlan(DB, cliente, entrada, usuario, { hoy, timeoutMs = TIMEOUT_MS }) {
  const { texto, sucursal_id, periodo, inicio } = leerEntrada(DB, entrada || {});
  if (!cliente) throw errorCon(503, "El planeador con IA no está configurado");
  if (planesDeHoy(DB, usuario?.id ?? null, hoy) >= LIMITE_DIARIO) throw errorCon(429, `Llegaste al límite de ${LIMITE_DIARIO} planes por hoy`);

  const contexto = armarDatosPlan(DB, { sucursal_id, periodo, inicio }, hoy);
  const objetivo_enviado = quitarNombres(DB, texto);
  const plan = {
    id: DB.pos.planes_ia.reduce((maximo, p) => Math.max(maximo, p.id), 0) + 1, estado: "borrador",
    creado_por_id: usuario?.id ?? null, creado_por_nombre: usuario?.nombre || "desconocido", creado_en: new Date().toISOString(),
    entrada: { objetivo_texto: texto, objetivo_enviado, sucursal_id, periodo, inicio }, sin_historial: contexto.sinHistorial,
    propuesta: null, decisiones: [], validado_por_id: null, validado_por_nombre: null, validado_en: null, creados: null, error: null,
  };
  try {
    const crudo = await pedirAlModelo(cliente, { objetivo: objetivo_enviado, datos: contexto.datos, catalogo: contexto.catalogo }, timeoutMs);
    plan.propuesta = validarPropuesta(crudo, { ...contexto, periodo });
  } catch (e) {
    plan.estado = "fallido";
    plan.error = String(e.message || e).slice(0, 300);
    DB.pos.planes_ia.push(plan);
    throw errorCon(502, MENSAJE_FALLA);
  }
  DB.pos.planes_ia.push(plan);
  return plan;
}

module.exports = { proponerPlan, MENSAJE_FALLA, LIMITE_DIARIO, MODELO, HERRAMIENTA };
```
Nota: un intento `fallido` responde 502, así que el guardado automático no corre en esa petición; queda en memoria y se escribe con la siguiente mutación. Es aceptable (solo es registro y cuenta para el límite mientras el servidor siga arriba).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test planIA.test.js planIADatos.test.js planIAValidar.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/planIA.js backend/planIA.test.js
git commit -m "feat(planeador-ia): pedir el borrador a la IA con limite, tiempo maximo y registro"
```

---

### Task 5: Validación humana y creación todo o nada (`planIACrear.js`)

**Files:**
- Create: `backend/planIACrear.js`
- Test: `backend/planIACrear.test.js`

**Interfaces:**
- Consumes: `crearOkr`, `crearMeta` con `{ origen }` (Task 3); `estaActivo` de `./vendedores`.
- Produces:
  - `validarPlan(DB, id, cuerpo, usuario) → plan` donde `cuerpo = { okr: { decision: "aceptar"|"rechazar", cambios?: { titulo?, descripcion? } }, metas: [{ indice, decision, cambios?: { nombre?, unidad?, prueba?, valor_meta? }, alcance?: "base"|"persona", vendedor_id? }] }`; deja `plan.estado = "validado"`, `plan.creados = { okr_clave: number|null, metas_claves: number[] }`, `plan.decisiones = [{ punto: "okr"|number, decision, cambios: { campo: [antes, despues] } }]`.
  - `descartarPlan(DB, id, usuario) → plan` (`estado = "descartado"`).
  - `listarPlanes(DB) → plan[]` (más reciente primero, máximo 50).

- [ ] **Step 1: Write the failing test**

```js
// backend/planIACrear.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validarPlan, descartarPlan, listarPlanes } = require("./planIACrear");

const VICTOR = { id: 70, nombre: "Victor" };
const PROPUESTA = { okr: { titulo: "Más acústicas", descripcion: null }, metas: [
  { indice: 0, accion: "actividad:grupos", nombre: "Publicar", unidad: "publicaciones", prueba: "liga", valor_meta: 4 },
  { indice: 1, accion: "actividad:iglesia", nombre: "Salidas", unidad: "salidas", prueba: "foto", valor_meta: 1 },
  { indice: 2, accion: "nueva", nombre: "Clínica", unidad: "clínica", prueba: "foto", valor_meta: 1 }] };
function dbConPlan(sucursal_id = 1) {
  return { admin: { usuarios: [] }, pos: {
    sucursales: [{ id: 1, nombre: "Ocosingo" }], vendedores: [{ id: 1, nombre: "Ana", sucursal_id: 1 }, { id: 2, nombre: "Bea", sucursal_id: 1, activo: false }],
    okrs: [], metas_personalizadas: [], meta_sellos: [],
    planes_ia: [{ id: 1, estado: "borrador", entrada: { sucursal_id, periodo: "mensual", inicio: "2026-11-01" }, propuesta: PROPUESTA,
      decisiones: [], validado_por_id: null, validado_por_nombre: null, validado_en: null, creados: null }],
  } };
}
const todo = (decision) => ({ okr: { decision }, metas: [0, 1, 2].map((indice) => ({ indice, decision })) });

test("crea exactamente lo aceptado, con cambios y origen, y deja el plan validado", () => {
  const DB = dbConPlan();
  const cuerpo = { okr: { decision: "aceptar", cambios: { titulo: "Más guitarras" } }, metas: [
    { indice: 0, decision: "aceptar", cambios: { valor_meta: 6 } }, { indice: 1, decision: "rechazar" }, { indice: 2, decision: "aceptar" }] };
  const plan = validarPlan(DB, 1, cuerpo, VICTOR);
  assert.equal(plan.estado, "validado");
  assert.equal(plan.validado_por_nombre, "Victor");
  assert.equal(DB.pos.okrs.length, 1);
  assert.equal(DB.pos.okrs[0].titulo, "Más guitarras");
  assert.deepEqual(DB.pos.metas_personalizadas.map((m) => [m.nombre, m.valor_meta, m.okr_clave]), [["Publicar", 6, 1], ["Clínica", 1, 1]]);
  assert.equal(DB.pos.metas_personalizadas[0].origen.tipo, "plan_ia");
  assert.equal(DB.pos.metas_personalizadas[0].origen.plan_id, 1);
  assert.deepEqual(plan.creados, { okr_clave: 1, metas_claves: [1, 2] });
  assert.deepEqual(plan.decisiones.find((d) => d.punto === 0).cambios, { valor_meta: [4, 6] });
});

test("falta decidir un punto, sobra uno, decision rara o nada aceptado: 400 y nada creado", () => {
  const casos = [
    { okr: { decision: "aceptar" }, metas: [{ indice: 0, decision: "aceptar" }, { indice: 1, decision: "aceptar" }] },
    { okr: { decision: "aceptar" }, metas: [0, 1, 2, 3].map((indice) => ({ indice, decision: "aceptar" })) },
    { okr: { decision: "aceptar" }, metas: [0, 0, 2].map((indice) => ({ indice, decision: "aceptar" })) },
    { okr: { decision: "quizas" }, metas: [0, 1, 2].map((indice) => ({ indice, decision: "aceptar" })) },
    { okr: {}, metas: [0, 1, 2].map((indice) => ({ indice, decision: "aceptar" })) },
    todo("rechazar"),
    { okr: { decision: "aceptar", cambios: { alcance: "empresa" } }, metas: [0, 1, 2].map((indice) => ({ indice, decision: "aceptar" })) },
  ];
  for (const cuerpo of casos) {
    const DB = dbConPlan();
    assert.throws(() => validarPlan(DB, 1, cuerpo, VICTOR));
    assert.equal(DB.pos.okrs.length + DB.pos.metas_personalizadas.length, 0, JSON.stringify(cuerpo));
    assert.equal(DB.pos.planes_ia[0].estado, "borrador");
  }
});

test("todo o nada: si una meta no se puede crear, no queda ningun OKR ni meta", () => {
  const DB = dbConPlan();
  const cuerpo = { okr: { decision: "aceptar" }, metas: [{ indice: 0, decision: "aceptar" }, { indice: 1, decision: "aceptar" },
    { indice: 2, decision: "aceptar", cambios: { valor_meta: 0 } }] };
  assert.throws(() => validarPlan(DB, 1, cuerpo, VICTOR), /cifra/);
  assert.equal(DB.pos.okrs.length + DB.pos.metas_personalizadas.length, 0);
  DB.pos.meta_sellos.push({ periodo: "mensual", inicio: "2026-11-01" });
  assert.throws(() => validarPlan(DB, 1, todo("aceptar"), VICTOR), /sellado/);
  assert.equal(DB.pos.okrs.length + DB.pos.metas_personalizadas.length, 0);
});

test("segunda validacion del mismo plan: 400 y sin duplicados", () => {
  const DB = dbConPlan();
  validarPlan(DB, 1, todo("aceptar"), VICTOR);
  assert.throws(() => validarPlan(DB, 1, todo("aceptar"), VICTOR), /ya no está en borrador/);
  assert.equal(DB.pos.metas_personalizadas.length, 3);
});

test("meta cambiada a persona se crea suelta; OKR rechazado deja las metas sueltas", () => {
  const DB = dbConPlan();
  validarPlan(DB, 1, { okr: { decision: "aceptar" }, metas: [{ indice: 0, decision: "aceptar", alcance: "persona", vendedor_id: 1 },
    { indice: 1, decision: "aceptar" }, { indice: 2, decision: "rechazar" }] }, VICTOR);
  const [persona, tienda] = DB.pos.metas_personalizadas;
  assert.deepEqual([persona.okr_clave, persona.alcance, persona.vendedor_id], [null, "persona", 1]);
  assert.equal(tienda.okr_clave, 1);
  const otro = dbConPlan();
  validarPlan(otro, 1, { okr: { decision: "rechazar" }, metas: [0, 1, 2].map((indice) => ({ indice, decision: "aceptar" })) }, VICTOR);
  assert.equal(otro.pos.okrs.length, 0);
  assert.ok(otro.pos.metas_personalizadas.every((m) => m.okr_clave === null && m.alcance === "tienda" && m.sucursal_id === 1));
});

test("toda la empresa: participantes son las personas activas; sin activas, error claro", () => {
  const DB = dbConPlan(null);
  validarPlan(DB, 1, todo("aceptar"), VICTOR);
  assert.deepEqual(DB.pos.okrs[0].participantes, [1]);
  const vacio = dbConPlan(null);
  vacio.pos.vendedores.forEach((v) => { v.activo = false; });
  assert.throws(() => validarPlan(vacio, 1, todo("aceptar"), VICTOR), /participantes/);
});

test("descartar no crea nada; listar trae lo mas reciente primero", () => {
  const DB = dbConPlan();
  assert.equal(descartarPlan(DB, 1, VICTOR).estado, "descartado");
  assert.throws(() => validarPlan(DB, 1, todo("aceptar"), VICTOR), /ya no está en borrador/);
  assert.throws(() => descartarPlan(DB, 99, VICTOR), /no existe/);
  DB.pos.planes_ia.push({ id: 2, estado: "fallido" });
  assert.deepEqual(listarPlanes(DB).map((p) => p.id), [2, 1]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test planIACrear.test.js`
Expected: FAIL con "Cannot find module './planIACrear'".

- [ ] **Step 3: Write minimal implementation**

```js
// backend/planIACrear.js
// Lo que propuso la IA se crea SOLO aquí, y solo si una persona con permiso decidió cada punto
// (regla de Victor 2026-10-12). Todo o nada: si una sola cosa no se puede crear, no se crea ninguna.
const M = require("./metasPersonalizadas");
const { estaActivo } = require("./vendedores");

const DECISIONES = ["aceptar", "rechazar"];
const CAMBIABLES_OKR = ["titulo", "descripcion"];
const CAMBIABLES_META = ["nombre", "unidad", "prueba", "valor_meta"];

function planEnBorrador(DB, id) {
  const plan = DB.pos.planes_ia.find((p) => p.id === Number(id));
  if (!plan) throw new Error("El plan no existe");
  if (plan.estado !== "borrador") throw new Error("Este plan ya no está en borrador; no se puede validar ni descartar otra vez");
  return plan;
}

function leerCambios(cambios, permitidos, original) {
  if (cambios === undefined || cambios === null) return { valores: {}, diferencias: {} };
  if (typeof cambios !== "object") throw new Error("Los cambios deben ser un objeto");
  const valores = {};
  const diferencias = {};
  for (const [campo, valor] of Object.entries(cambios)) {
    if (!permitidos.includes(campo)) throw new Error(`No se puede cambiar ${campo} desde el plan`);
    valores[campo] = valor;
    if (original[campo] !== valor) diferencias[campo] = [original[campo] ?? null, valor];
  }
  return { valores, diferencias };
}

function leerDecisiones(plan, cuerpo) {
  const propuestas = plan.propuesta.metas;
  if (!DECISIONES.includes(cuerpo?.okr?.decision)) throw new Error("Falta decidir si aceptas o rechazas el OKR");
  if (!Array.isArray(cuerpo.metas) || cuerpo.metas.length !== propuestas.length) throw new Error("Falta decidir sobre todas las metas");
  const vistos = new Set();
  const metas = cuerpo.metas.map((d) => {
    const original = propuestas.find((m) => m.indice === Number(d?.indice));
    if (!original || vistos.has(original.indice)) throw new Error("Las decisiones no corresponden a las metas del plan");
    vistos.add(original.indice);
    if (!DECISIONES.includes(d.decision)) throw new Error(`Falta decidir sobre la meta "${original.nombre}"`);
    const persona = d.alcance === "persona";
    if (d.alcance !== undefined && d.alcance !== "base" && !persona) throw new Error("El alcance de la meta debe ser base o persona");
    return { original, decision: d.decision, persona, vendedor_id: d.vendedor_id, ...leerCambios(d.cambios, CAMBIABLES_META, original) };
  });
  const okr = { decision: cuerpo.okr.decision, ...leerCambios(cuerpo.okr.cambios, CAMBIABLES_OKR, plan.propuesta.okr) };
  if (okr.decision === "rechazar" && metas.every((m) => m.decision === "rechazar")) {
    throw new Error("No aceptaste ningún punto; si no quieres nada del plan, descártalo");
  }
  return { okr, metas };
}

function alcanceBase(DB, entrada) {
  if (entrada.sucursal_id !== null) return { alcance: "tienda", sucursal_id: entrada.sucursal_id };
  return { alcance: "empresa", participantes: DB.pos.vendedores.filter(estaActivo).map((v) => v.id) };
}

function validarPlan(DB, id, cuerpo, usuario) {
  const plan = planEnBorrador(DB, id);
  const { okr, metas } = leerDecisiones(plan, cuerpo);
  const { periodo, inicio } = plan.entrada;
  const base = alcanceBase(DB, plan.entrada);
  const validado_en = new Date().toISOString();
  const origen = { tipo: "plan_ia", plan_id: plan.id, validado_por_nombre: usuario?.nombre || "desconocido", validado_en };
  const largoOkrs = DB.pos.okrs.length;
  const largoMetas = DB.pos.metas_personalizadas.length;
  let creados;
  try {
    // Todo es síncrono: ninguna otra petición se mete entre estas altas, así que recortar las listas deshace todo.
    const okrCreado = okr.decision === "aceptar"
      ? M.crearOkr(DB, { ...plan.propuesta.okr, ...okr.valores, periodo, inicio, ...base }, usuario, { origen }) : null;
    const metas_claves = metas.filter((m) => m.decision === "aceptar").map((m) => {
      const { nombre, unidad, prueba, valor_meta } = { ...m.original, ...m.valores };
      const destino = m.persona ? { periodo, inicio, alcance: "persona", vendedor_id: m.vendedor_id }
        : okrCreado ? { okr_clave: okrCreado.clave } : { periodo, inicio, ...base };
      return M.crearMeta(DB, { nombre, unidad, prueba, valor_meta, ...destino }, usuario, { origen }).clave;
    });
    creados = { okr_clave: okrCreado?.clave ?? null, metas_claves };
  } catch (e) {
    DB.pos.okrs.length = largoOkrs;
    DB.pos.metas_personalizadas.length = largoMetas;
    throw e;
  }
  plan.decisiones = [{ punto: "okr", decision: okr.decision, cambios: okr.diferencias },
    ...metas.map((m) => ({ punto: m.original.indice, decision: m.decision, cambios: m.diferencias }))];
  Object.assign(plan, { estado: "validado", validado_por_id: usuario?.id ?? null, validado_por_nombre: origen.validado_por_nombre,
    validado_en, creados });
  return plan;
}

function descartarPlan(DB, id, usuario) {
  const plan = planEnBorrador(DB, id);
  Object.assign(plan, { estado: "descartado", descartado_por_nombre: usuario?.nombre || "desconocido", descartado_en: new Date().toISOString() });
  return plan;
}

const listarPlanes = (DB) => [...DB.pos.planes_ia].sort((a, b) => b.id - a.id).slice(0, 50);

module.exports = { validarPlan, descartarPlan, listarPlanes };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test planIACrear.test.js metasPersonalizadas.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/planIACrear.js backend/planIACrear.test.js
git commit -m "feat(planeador-ia): crear solo lo validado punto por punto, todo o nada"
```

---

### Task 6: Rutas y conexión con el servidor

**Files:**
- Modify: `backend/metasRutas.js` (imports arriba; rutas antes de `app.post("/api/metas", ...)` ~línea 87)
- Modify: `backend/server.js` (~línea 2924, objeto de dependencias de `metasRutas`)
- Test: `backend/metasPlanIARutas.test.js` (nuevo)

**Interfaces:**
- Consumes: `proponerPlan` (Task 4), `validarPlan`/`descartarPlan`/`listarPlanes` (Task 5).
- Produces (todas con `requiereLogin` + permiso `administrar_metas_personalizadas`):
  - `GET  /api/metas/plan-ia` → `{ configurado: boolean, planes: plan[] }`
  - `POST /api/metas/plan-ia` body `{ objetivo_texto, sucursal_id|null, periodo, inicio }` → plan (o `{ error }` con 400/429/502/503)
  - `POST /api/metas/plan-ia/:id/validar` body = cuerpo de Task 5 → plan
  - `POST /api/metas/plan-ia/:id/descartar` → plan
  - Dependencia nueva `clienteIA: () => cliente|null`; en pruebas se fija con `app.locals.clienteIA`.

- [ ] **Step 1: Write the failing test**

```js
// backend/metasPlanIARutas.test.js
/** Rutas del planeador con IA: permiso, validacion completa exigida en el servidor y todo o nada. */
const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "plan-ia-rutas-")), "datos.sqlite");
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";
const app = require("./server");
const { sembrarCuentas } = require("./testHelpers");
const { firmarToken } = require("./auth");
const { crearRol } = require("./roles");
const { inicioDePeriodo } = require("./metasPeriodos");
const { fechaLocal } = require("./fechas");

const INICIO = inicioDePeriodo("mensual", fechaLocal(new Date()));
const ENTRADA = { objetivo_texto: "Vender más acústicas", sucursal_id: 1, periodo: "mensual", inicio: INICIO };
const PROPUESTA = { okr: { titulo: "Más acústicas" }, metas: [
  { accion: "nueva", nombre: "Clínica", unidad: "clínica", prueba: "foto", valor_meta: 1, por_que: "" },
  { accion: "nueva", nombre: "Video", unidad: "videos", prueba: "liga", valor_meta: 2, por_que: "" },
  { accion: "actividad:volanteo", nombre: "Volanteo", unidad: "jornadas", prueba: "foto", valor_meta: 2, por_que: "" }] };
const clienteFalso = { messages: { create: async () => ({ content: [{ type: "tool_use", name: "proponer_plan", input: PROPUESTA }] }) } };
let servidor, base, admin, gerente;

before(async () => {
  const rolGerente = crearRol(app.DB, { nombre: "Gerencia plan ia", modulos: ["pos"],
    permisos: ["usar_gerente_ventas", "anular_capturas_metas"] });
  const cuentas = [{ id: 80, nombre: "Admin plan", rol_id: 1, sucursal_id: 1 }, { id: 81, nombre: "Gerente plan", rol_id: rolGerente.id, sucursal_id: 1 }];
  sembrarCuentas(app, cuentas);
  [admin, gerente] = cuentas.map(firmarToken);
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

beforeEach(() => {
  for (const coleccion of ["okrs", "metas_personalizadas", "meta_sellos", "planes_ia"]) app.DB.pos[coleccion] = [];
  app.locals.clienteIA = clienteFalso;
});

after(async () => {
  delete app.locals.clienteIA;
  if (servidor) await new Promise((listo) => servidor.close(listo));
});

async function pedir(metodo, ruta, token, datos) {
  const r = await fetch(base + ruta, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(datos === undefined ? {} : { body: JSON.stringify(datos) }),
  });
  let cuerpo = null;
  try { cuerpo = await r.json(); } catch (_) { /* sin cuerpo */ }
  return { status: r.status, cuerpo };
}
const todo = (decision) => ({ okr: { decision }, metas: [0, 1, 2].map((indice) => ({ indice, decision })) });

test("sin permiso de administrar: 403 en las cuatro rutas y nada creado", async () => {
  assert.equal((await pedir("GET", "/api/metas/plan-ia", gerente)).status, 403);
  assert.equal((await pedir("POST", "/api/metas/plan-ia", gerente, ENTRADA)).status, 403);
  const plan = (await pedir("POST", "/api/metas/plan-ia", admin, ENTRADA)).cuerpo;
  assert.equal((await pedir("POST", `/api/metas/plan-ia/${plan.id}/validar`, gerente, todo("aceptar"))).status, 403);
  assert.equal((await pedir("POST", `/api/metas/plan-ia/${plan.id}/descartar`, gerente)).status, 403);
  assert.equal(app.DB.pos.metas_personalizadas.length, 0);
});

test("flujo completo: proponer no crea nada; validar crea lo aceptado con origen visible en el historial", async () => {
  const r = await pedir("POST", "/api/metas/plan-ia", admin, ENTRADA);
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.cuerpo.estado, "borrador");
  assert.equal(app.DB.pos.okrs.length + app.DB.pos.metas_personalizadas.length, 0);
  const v = await pedir("POST", `/api/metas/plan-ia/${r.cuerpo.id}/validar`, admin, todo("aceptar"));
  assert.equal(v.status, 200, JSON.stringify(v));
  assert.equal(app.DB.pos.metas_personalizadas.length, 3);
  const historial = await pedir("GET", `/api/metas/${v.cuerpo.creados.metas_claves[0]}/historial`, admin);
  assert.equal(historial.cuerpo[0].origen.validado_por_nombre, "Admin plan");
  const lista = await pedir("GET", "/api/metas/plan-ia", admin);
  assert.equal(lista.cuerpo.configurado, true);
  assert.equal(lista.cuerpo.planes[0].estado, "validado");
});

test("validar incompleto o dos veces: 400 y nada de mas", async () => {
  const plan = (await pedir("POST", "/api/metas/plan-ia", admin, ENTRADA)).cuerpo;
  const incompleto = { okr: { decision: "aceptar" }, metas: [{ indice: 0, decision: "aceptar" }] };
  assert.equal((await pedir("POST", `/api/metas/plan-ia/${plan.id}/validar`, admin, incompleto)).status, 400);
  assert.equal(app.DB.pos.metas_personalizadas.length, 0);
  assert.equal((await pedir("POST", `/api/metas/plan-ia/${plan.id}/validar`, admin, todo("aceptar"))).status, 200);
  assert.equal((await pedir("POST", `/api/metas/plan-ia/${plan.id}/validar`, admin, todo("aceptar"))).status, 400);
  assert.equal(app.DB.pos.metas_personalizadas.length, 3);
});

test("sin IA configurada: GET dice configurado false y POST responde 503", async () => {
  app.locals.clienteIA = null;
  assert.equal((await pedir("GET", "/api/metas/plan-ia", admin)).cuerpo.configurado, false);
  assert.equal((await pedir("POST", "/api/metas/plan-ia", admin, ENTRADA)).status, 503);
});

test("falla de la IA: 502 con el mensaje para la pantalla", async () => {
  app.locals.clienteIA = { messages: { create: async () => { throw new Error("caida"); } } };
  const r = await pedir("POST", "/api/metas/plan-ia", admin, ENTRADA);
  assert.equal(r.status, 502);
  assert.match(r.cuerpo.error, /dar de alta las metas a mano/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test metasPlanIARutas.test.js`
Expected: FAIL (404 en `/api/metas/plan-ia`).

- [ ] **Step 3: Implementación**

En `backend/metasRutas.js`, imports junto a los demás:

```js
const { proponerPlan } = require("./planIA");
const { validarPlan, descartarPlan, listarPlanes } = require("./planIACrear");
```
En la desestructuración de `deps` agrega `clienteIA`:

```js
  const { DB, drive, requiereLogin, requierePermiso, resolverPermisosDeRol, resolverAlcanceAutorizado, vendedorLigadoAObjetivos, idDeObjetivos,
    clienteIA } = deps;
```
Justo antes de `app.post("/api/metas", requiereLogin, admin, ...)`:

```js
  // Planeador con IA: la IA solo propone; se crea únicamente lo que una persona con permiso validó punto por punto.
  app.get("/api/metas/plan-ia", requiereLogin, admin, (req, res) => responder(res, () => ({ configurado: Boolean(clienteIA()), planes: listarPlanes(DB) })));
  app.post("/api/metas/plan-ia", requiereLogin, admin, async (req, res) => {
    try {
      res.json(await proponerPlan(DB, clienteIA(), req.body || {}, req.usuarioToken, { hoy: hoy() }));
    } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
  });
  app.post("/api/metas/plan-ia/:id/validar", requiereLogin, admin, (req, res) => responder(res, () =>
    validarPlan(DB, idDeObjetivos(req.params.id, "id"), req.body || {}, req.usuarioToken)));
  app.post("/api/metas/plan-ia/:id/descartar", requiereLogin, admin, (req, res) => responder(res, () =>
    descartarPlan(DB, idDeObjetivos(req.params.id, "id"), req.usuarioToken)));
```
En `backend/server.js` (~línea 2924), en el objeto de dependencias:

```js
require("./metasRutas")(app, {
  DB, drive, requiereLogin, requierePermiso, resolverPermisosDeRol, resolverAlcanceAutorizado, vendedorLigadoAObjetivos, idDeObjetivos,
  // Las pruebas fijan app.locals.clienteIA con un cliente falso; sin ANTHROPIC_API_KEY el planeador queda apagado.
  clienteIA: () => (app.locals.clienteIA !== undefined ? app.locals.clienteIA : (process.env.ANTHROPIC_API_KEY ? anthropic : null)),
});
```

- [ ] **Step 4: Run tests**

Run (una por una): `cd backend && node --test metasPlanIARutas.test.js`, luego `node --test metasRutas.test.js metasPermisos.test.js`
Expected: PASS. Si `idDeObjetivos` lanza con un mensaje sobre el campo, revisa que el 400 siga saliendo por `responder`.

- [ ] **Step 5: Commit**

```bash
git add backend/metasRutas.js backend/server.js backend/metasPlanIARutas.test.js
git commit -m "feat(planeador-ia): rutas con permiso de administrar metas"
```

---

### Task 7: Lógica pura de la ventana (`src/metas/planIA.js`)

**Files:**
- Create: `src/metas/planIA.js`
- Test: `src/metas/planIA.test.js`

**Interfaces:**
- Consumes: `etiquetaPeriodo` de `./metas.js`.
- Produces:
  - `estadoInicial(plan) → { okr: { decision: null, form: { titulo, descripcion } }, metas: [{ indice, decision: null, form: { nombre, unidad, prueba, valor_meta: string }, alcance: "base", vendedor_id: "" }] }`
  - `faltanPorDecidir(estado) → number`
  - `puedeCrear(estado) → boolean`
  - `cuerpoValidacion(plan, estado) → cuerpo de Task 5`
  - `resumenConfirmacion(plan, estado, nombreDestino) → string`

- [ ] **Step 1: Write the failing test**

```js
// src/metas/planIA.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoInicial, faltanPorDecidir, puedeCrear, cuerpoValidacion, resumenConfirmacion } from "./planIA.js";

const PLAN = { id: 4, entrada: { periodo: "mensual", inicio: "2026-11-01" }, propuesta: {
  okr: { titulo: "Más acústicas", descripcion: null },
  metas: [{ indice: 0, nombre: "Publicar", unidad: "pub", prueba: "liga", valor_meta: 4 },
    { indice: 1, nombre: "Salidas", unidad: "salidas", prueba: "foto", valor_meta: 1 }] } };

test("nada viene decidido al empezar", () => {
  const e = estadoInicial(PLAN);
  assert.equal(e.okr.decision, null);
  assert.ok(e.metas.every((m) => m.decision === null));
  assert.equal(faltanPorDecidir(e), 3);
  assert.equal(puedeCrear(e), false);
});

test("puedeCrear exige decidir todo, aceptar algo y elegir persona si se cambio a persona", () => {
  const e = estadoInicial(PLAN);
  e.okr.decision = "rechazar"; e.metas[0].decision = "rechazar";
  assert.equal(puedeCrear(e), false); // falta la meta 1
  e.metas[1].decision = "rechazar";
  assert.equal(puedeCrear(e), false); // nada aceptado
  e.metas[1].decision = "aceptar"; e.metas[1].alcance = "persona";
  assert.equal(puedeCrear(e), false); // sin persona
  e.metas[1].vendedor_id = "3";
  assert.equal(puedeCrear(e), true);
});

test("cuerpoValidacion manda solo lo que cambio y la persona como numero", () => {
  const e = estadoInicial(PLAN);
  e.okr.decision = "aceptar"; e.okr.form.titulo = "Más guitarras";
  e.metas[0].decision = "aceptar"; e.metas[0].form.valor_meta = "6";
  e.metas[1].decision = "aceptar"; e.metas[1].alcance = "persona"; e.metas[1].vendedor_id = "3";
  assert.deepEqual(cuerpoValidacion(PLAN, e), {
    okr: { decision: "aceptar", cambios: { titulo: "Más guitarras" } },
    metas: [{ indice: 0, decision: "aceptar", cambios: { valor_meta: 6 }, alcance: "base" },
      { indice: 1, decision: "aceptar", cambios: {}, alcance: "persona", vendedor_id: 3 }],
  });
});

test("resumenConfirmacion cuenta lo aceptado", () => {
  const e = estadoInicial(PLAN);
  e.okr.decision = "aceptar"; e.metas[0].decision = "aceptar"; e.metas[1].decision = "rechazar";
  assert.equal(resumenConfirmacion(PLAN, e, "Ocosingo"), "Vas a crear 1 OKR y 1 meta para Ocosingo, Noviembre de 2026");
  e.okr.decision = "rechazar"; e.metas[1].decision = "aceptar";
  assert.equal(resumenConfirmacion(PLAN, e, "toda la empresa"), "Vas a crear 2 metas para toda la empresa, Noviembre de 2026");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/metas/planIA.test.js`
Expected: FAIL (no existe `./planIA.js`).

- [ ] **Step 3: Write minimal implementation**

```js
// src/metas/planIA.js
// Lógica de la ventana del planeador con IA. Nada viene aceptado de entrada: cada punto se decide a mano.
import { etiquetaPeriodo } from "./metas.js";

export function estadoInicial(plan) {
  const { okr, metas } = plan.propuesta;
  return {
    okr: { decision: null, form: { titulo: okr.titulo, descripcion: okr.descripcion || "" } },
    metas: metas.map((m) => ({ indice: m.indice, decision: null, alcance: "base", vendedor_id: "",
      form: { nombre: m.nombre, unidad: m.unidad, prueba: m.prueba, valor_meta: String(m.valor_meta) } })),
  };
}

const puntos = (estado) => [estado.okr, ...estado.metas];
export const faltanPorDecidir = (estado) => puntos(estado).filter((p) => !p.decision).length;

export function puedeCrear(estado) {
  return faltanPorDecidir(estado) === 0 && puntos(estado).some((p) => p.decision === "aceptar")
    && estado.metas.every((m) => m.decision !== "aceptar" || m.alcance !== "persona" || m.vendedor_id !== "");
}

function cambios(original, form) {
  const salida = {};
  for (const [campo, valor] of Object.entries(form)) {
    const final = campo === "valor_meta" ? Number(valor) : valor;
    if ((original[campo] ?? "") !== final) salida[campo] = final;
  }
  return salida;
}

export function cuerpoValidacion(plan, estado) {
  return {
    okr: { decision: estado.okr.decision, cambios: cambios(plan.propuesta.okr, estado.okr.form) },
    metas: estado.metas.map((m) => {
      const original = plan.propuesta.metas.find((p) => p.indice === m.indice);
      const comun = { indice: m.indice, decision: m.decision, cambios: cambios(original, m.form), alcance: m.alcance };
      return m.alcance === "persona" ? { ...comun, vendedor_id: Number(m.vendedor_id) } : comun;
    }),
  };
}

export function resumenConfirmacion(plan, estado, nombreDestino) {
  const metas = estado.metas.filter((m) => m.decision === "aceptar").length;
  const partes = [estado.okr.decision === "aceptar" ? "1 OKR" : null, metas ? `${metas} meta${metas === 1 ? "" : "s"}` : null].filter(Boolean);
  return `Vas a crear ${partes.join(" y ")} para ${nombreDestino}, ${etiquetaPeriodo(plan.entrada.periodo, plan.entrada.inicio)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/metas/planIA.test.js`
Expected: PASS (4 pruebas).

- [ ] **Step 5: Commit**

```bash
git add src/metas/planIA.js src/metas/planIA.test.js
git commit -m "feat(planeador-ia): logica de la ventana de revision"
```

---

### Task 8: Pantallas (ventana de 3 pasos, lista de planes, origen en historial)

**Files:**
- Create: `src/metas/PlaneadorIA.jsx`, `src/metas/PlanesIA.jsx`
- Modify: `src/metas/AdministrarMetas.jsx` (imports; `Historial` ~línea 160; botones ~línea 231; diálogos ~línea 280)

**Interfaces:**
- Consumes: rutas de Task 6; funciones de Task 7; `apiFetch` (`../api`), `leer` (`../objetivos/datos`), `ALERTA`, `EXITO`, `ENLACE`, `fechaHora` (`./Comunes`), `TEXTO_PRUEBA`, `etiquetaPeriodo` (`./metas`).
- Produces: `<PlaneadorIA periodo inicio sucursales vendedores cerrar alTerminar />`, `<PlanesIA planes sucursales cerrar />`.

- [ ] **Step 1: `src/metas/PlaneadorIA.jsx`**

```jsx
import { useState } from "react";
import { apiFetch } from "../api";
import { leer } from "../objetivos/datos";
import { ALERTA } from "./Comunes";
import { TEXTO_PRUEBA, etiquetaPeriodo } from "./metas";
import { cuerpoValidacion, estadoInicial, faltanPorDecidir, puedeCrear, resumenConfirmacion } from "./planIA";

const BOTON = "bg-blue-600 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50";
const SECUNDARIO = "border border-slate-300 rounded-lg px-4 py-2 text-sm";
const CAMPO = "neu-campo rounded-lg px-2 py-1 w-full text-sm";
const DECISION = (activa, color) => `px-3 py-1 rounded-lg border text-sm ${activa ? `${color} text-white` : "bg-white text-slate-700 border-slate-300"}`;

function Decidir({ punto, cambiar }) {
  return (
    <span className="flex gap-2 shrink-0">
      <button type="button" aria-pressed={punto.decision === "aceptar"} className={DECISION(punto.decision === "aceptar", "bg-emerald-600 border-emerald-600")}
        onClick={() => cambiar({ decision: "aceptar" })}>Aceptar</button>
      <button type="button" aria-pressed={punto.decision === "rechazar"} className={DECISION(punto.decision === "rechazar", "bg-red-600 border-red-600")}
        onClick={() => cambiar({ decision: "rechazar" })}>Rechazar</button>
    </span>
  );
}

// Planeador con IA: la IA solo propone. Se crea únicamente lo que aceptas punto por punto (regla de Victor 2026-10-12).
export default function PlaneadorIA({ periodo, inicio, sucursales, vendedores, cerrar, alTerminar }) {
  const [paso, setPaso] = useState(1);
  const [entrada, setEntrada] = useState({ objetivo_texto: "", sucursal_id: "" });
  const [plan, setPlan] = useState(null);
  const [estado, setEstado] = useState(null);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const destino = entrada.sucursal_id ? sucursales.find((s) => s.id === Number(entrada.sucursal_id))?.nombre : "toda la empresa";

  const proponer = async () => {
    setError(""); setEnviando(true);
    try {
      const cuerpo = { ...entrada, sucursal_id: entrada.sucursal_id ? Number(entrada.sucursal_id) : null, periodo, inicio };
      const nuevo = await apiFetch("/metas/plan-ia", { method: "POST", body: JSON.stringify(cuerpo) }).then((r) => leer(r, "No se pudo armar el plan"));
      setPlan(nuevo); setEstado(estadoInicial(nuevo)); setPaso(2);
    } catch (e) { setError(e.message); } finally { setEnviando(false); }
  };
  const enviar = async (ruta, cuerpo) => {
    setError(""); setEnviando(true);
    try {
      await apiFetch(`/metas/plan-ia/${plan.id}/${ruta}`, { method: "POST", body: JSON.stringify(cuerpo || {}) }).then((r) => leer(r, "No se pudo guardar"));
      alTerminar(ruta === "validar" ? "Se crearon las metas que validaste." : "Plan descartado. Quedó en el registro.");
    } catch (e) { setError(e.message); setPaso(2); } finally { setEnviando(false); }
  };
  const cambiarOkr = (cambio) => setEstado({ ...estado, okr: { ...estado.okr, ...cambio } });
  const cambiarMeta = (i, cambio) => setEstado({ ...estado, metas: estado.metas.map((m, j) => (j === i ? { ...m, ...cambio } : m)) });
  const vendedoresDestino = vendedores.filter((v) => !entrada.sucursal_id || v.sucursal_id === Number(entrada.sucursal_id));

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label="Proponer plan con IA"
        className="bg-white rounded-xl p-5 w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-3">
        <h3 className="font-semibold">✨ Proponer plan con IA · {etiquetaPeriodo(periodo, inicio)}</h3>
        {paso === 1 && (
          <>
            <label className="block text-sm">Qué quieres lograr
              <textarea className={`${CAMPO} mt-1`} rows={3} maxLength={500} value={entrada.objetivo_texto}
                onChange={(e) => setEntrada({ ...entrada, objetivo_texto: e.target.value })} />
              <span className="text-xs text-slate-500">No escribas nombres de personas.</span>
            </label>
            <label className="block text-sm">Para
              <select className={`${CAMPO} mt-1`} value={entrada.sucursal_id} onChange={(e) => setEntrada({ ...entrada, sucursal_id: e.target.value })}>
                <option value="">Toda la empresa</option>
                {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </label>
            <p className="text-xs text-slate-500">Para otro periodo, cierra esta ventana y cámbialo arriba.</p>
          </>
        )}
        {paso === 2 && estado && (
          <>
            {plan.sin_historial && <p className={ALERTA}>Esta tienda no tiene historial; las cifras son una propuesta sin datos, revísalas con cuidado.</p>}
            <section className="border rounded-lg p-3 space-y-2">
              <div className="flex gap-2 items-start">
                <div className="flex-1 space-y-1">
                  <span className="text-xs font-semibold text-slate-500">OKR</span>
                  <input className={CAMPO} aria-label="Título del OKR" value={estado.okr.form.titulo}
                    onChange={(e) => cambiarOkr({ form: { ...estado.okr.form, titulo: e.target.value } })} />
                  <input className={CAMPO} aria-label="Descripción del OKR" value={estado.okr.form.descripcion}
                    onChange={(e) => cambiarOkr({ form: { ...estado.okr.form, descripcion: e.target.value } })} />
                </div>
                <Decidir punto={estado.okr} cambiar={cambiarOkr} />
              </div>
            </section>
            {estado.metas.map((m, i) => {
              const propuesta = plan.propuesta.metas[i];
              const forma = (campo, valor) => cambiarMeta(i, { form: { ...m.form, [campo]: valor } });
              return (
                <section key={m.indice} className="border rounded-lg p-3 space-y-2">
                  <div className="flex gap-2 items-start">
                    <div className="flex-1 grid grid-cols-2 gap-2">
                      <input className={`${CAMPO} col-span-2`} aria-label="Nombre de la meta" value={m.form.nombre} onChange={(e) => forma("nombre", e.target.value)} />
                      <input className={CAMPO} type="number" min={1} aria-label="Cifra" value={m.form.valor_meta} onChange={(e) => forma("valor_meta", e.target.value)} />
                      <input className={CAMPO} aria-label="Unidad" value={m.form.unidad} onChange={(e) => forma("unidad", e.target.value)} />
                      <select className={CAMPO} aria-label="Prueba" value={m.form.prueba} onChange={(e) => forma("prueba", e.target.value)}>
                        {Object.entries(TEXTO_PRUEBA).map(([valor, texto]) => <option key={valor} value={valor}>{texto}</option>)}
                      </select>
                      <select className={CAMPO} aria-label="Para quién" value={m.alcance === "persona" ? m.vendedor_id || "?" : ""}
                        onChange={(e) => cambiarMeta(i, e.target.value ? { alcance: "persona", vendedor_id: e.target.value === "?" ? "" : e.target.value }
                          : { alcance: "base", vendedor_id: "" })}>
                        <option value="">{entrada.sucursal_id ? `Toda la tienda (${destino})` : "Toda la empresa"}</option>
                        <option value="?" disabled>Una persona…</option>
                        {vendedoresDestino.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
                      </select>
                    </div>
                    <Decidir punto={m} cambiar={(cambio) => cambiarMeta(i, cambio)} />
                  </div>
                  <p className="text-xs text-slate-500">
                    {propuesta.nueva && <span className="mr-2 rounded bg-violet-100 text-violet-800 px-1">Idea nueva</span>}
                    {propuesta.sin_historico && <span className="mr-2 rounded bg-amber-100 text-amber-800 px-1">Sin dato histórico</span>}
                    {propuesta.por_que}
                  </p>
                  {m.alcance === "persona" && <p className="text-xs text-amber-700">Esta meta quedará fuera del OKR porque es de una sola persona.</p>}
                </section>
              );
            })}
            {faltanPorDecidir(estado) > 0 && <p className="text-sm text-slate-600">Te faltan {faltanPorDecidir(estado)} puntos por aceptar o rechazar.</p>}
          </>
        )}
        {paso === 3 && <p className="text-sm font-medium">{resumenConfirmacion(plan, estado, destino)}</p>}
        {error && <p role="alert" className={ALERTA}>{error}</p>}
        <div className="flex flex-wrap gap-2 justify-end">
          {paso === 1 && <button type="button" className={SECUNDARIO} onClick={cerrar}>Cancelar</button>}
          {paso === 1 && (
            <button type="button" className={BOTON} disabled={enviando || !entrada.objetivo_texto.trim()} onClick={proponer}>
              {enviando ? "Armando el plan…" : "Proponer"}
            </button>
          )}
          {paso === 2 && <button type="button" className={SECUNDARIO} disabled={enviando} onClick={() => enviar("descartar")}>Descartar plan</button>}
          {paso === 2 && <button type="button" className={BOTON} disabled={!puedeCrear(estado)} onClick={() => setPaso(3)}>Crear las validadas</button>}
          {paso === 3 && <button type="button" className={SECUNDARIO} disabled={enviando} onClick={() => setPaso(2)}>Volver a revisar</button>}
          {paso === 3 && (
            <button type="button" className={BOTON} disabled={enviando} onClick={() => enviar("validar", cuerpoValidacion(plan, estado))}>
              {enviando ? "Creando…" : "Confirmar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```
Nota: en el paso 1 el error de la IA (502) se muestra y el texto se queda escrito (no se limpia `entrada`). Si `Escape` debe cerrar, no hace falta: el botón Cancelar basta.

- [ ] **Step 2: `src/metas/PlanesIA.jsx`**

```jsx
import { useState } from "react";
import { ENLACE, fechaHora } from "./Comunes";
import { etiquetaPeriodo } from "./metas";

const ESTADO = { borrador: "Borrador", validado: "Validado", descartado: "Descartado", fallido: "Falló" };
const texto = (d) => (d.decision === "aceptar" ? "Aceptada" : "Rechazada")
  + (Object.keys(d.cambios || {}).length ? ` · cambios: ${Object.entries(d.cambios).map(([c, [a, b]]) => `${c} ${a} → ${b}`).join(", ")}` : "");

// Registro de planes con IA: lo propuesto contra lo aprobado, con quién y cuándo.
export default function PlanesIA({ planes, sucursales, cerrar }) {
  const [abierto, setAbierto] = useState(null);
  const tienda = (id) => (id === null ? "Toda la empresa" : sucursales.find((s) => s.id === id)?.nombre || "Tienda");
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label="Planes con IA" className="bg-white rounded-xl p-5 w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-3">
        <h3 className="font-semibold">Planes con IA</h3>
        {!planes.length && <p className="text-sm text-slate-500">Todavía no hay planes.</p>}
        <ul className="space-y-2 text-sm">
          {planes.map((p) => (
            <li key={p.id} className="border rounded-lg p-3">
              <button type="button" className={`${ENLACE} text-left`} aria-expanded={abierto === p.id} onClick={() => setAbierto(abierto === p.id ? null : p.id)}>
                {fechaHora(p.creado_en)} · {p.creado_por_nombre} · {tienda(p.entrada?.sucursal_id ?? null)}
                {p.entrada ? ` · ${etiquetaPeriodo(p.entrada.periodo, p.entrada.inicio)}` : ""} · {ESTADO[p.estado]}
              </button>
              {abierto === p.id && (
                <div className="mt-2 space-y-1">
                  <p className="text-slate-600">Objetivo: {p.entrada?.objetivo_texto}</p>
                  {p.error && <p className="text-red-700">Motivo: {p.error}</p>}
                  {p.validado_por_nombre && <p>Validado por {p.validado_por_nombre} · {fechaHora(p.validado_en)}</p>}
                  {p.propuesta && (
                    <ul className="list-disc pl-5">
                      <li>OKR: {p.propuesta.okr.titulo}{p.decisiones[0] ? ` — ${texto(p.decisiones[0])}` : ""}</li>
                      {p.propuesta.metas.map((m) => {
                        const d = p.decisiones.find((x) => x.punto === m.indice);
                        return <li key={m.indice}>{m.nombre}: {m.valor_meta} {m.unidad}{d ? ` — ${texto(d)}` : ""}</li>;
                      })}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="flex justify-end"><button type="button" className="border border-slate-300 rounded-lg px-4 py-2 text-sm" onClick={cerrar}>Cerrar</button></div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Integrar en `src/metas/AdministrarMetas.jsx`**

Imports:

```jsx
import PlaneadorIA from "./PlaneadorIA";
import PlanesIA from "./PlanesIA";
```
En `Historial`, debajo de la línea `{v.motivo && <p>Motivo: {v.motivo}</p>}`:

```jsx
              {v.origen?.tipo === "plan_ia" && (
                <p className="text-violet-700">Origen: plan con IA · validado por {v.origen.validado_por_nombre} · {fechaHora(v.origen.validado_en)}</p>
              )}
```
En `AdministrarMetas`, estado nuevo y carga junto a `cargar`:

```jsx
  const [planes, setPlanes] = useState({ configurado: false, planes: [] });
```
y dentro de `cargar`, después de cargar el sello:

```jsx
      setPlanes(await apiFetch("/metas/plan-ia").then((r) => leer(r, "No se pudieron cargar los planes con IA")));
```
Reemplaza el bloque de botones `{abierto && (<div className="flex gap-2">…</div>)}` por:

```jsx
      {abierto && (
        <div className="flex flex-wrap gap-2 items-center">
          <button type="button" className={BOTON} onClick={() => { setExito(""); setDialogo({ tipo: "okr" }); }}>+ Nuevo OKR</button>
          <button type="button" className={BOTON} onClick={() => { setExito(""); setDialogo({ tipo: "meta" }); }}>+ Nueva meta</button>
          <button type="button" className={`${BOTON} bg-violet-600 disabled:opacity-50`} disabled={!planes.configurado}
            title={planes.configurado ? undefined : "El planeador con IA no está configurado"}
            onClick={() => { setExito(""); setDialogo({ tipo: "planeador" }); }}>✨ Proponer plan con IA</button>
          {!planes.configurado && <span className="text-xs text-slate-500">El planeador con IA no está configurado</span>}
        </div>
      )}
      {planes.planes.length > 0 && (
        <button type="button" className={`${ENLACE} text-sm`} onClick={() => setDialogo({ tipo: "planes" })}>Planes con IA ({planes.planes.length})</button>
      )}
```
Junto a los demás diálogos al final:

```jsx
      {dialogo?.tipo === "planeador" && (
        <PlaneadorIA periodo={periodo} inicio={inicio} sucursales={sucursales} vendedores={vendedores} cerrar={() => setDialogo(null)}
          alTerminar={terminar} />
      )}
      {dialogo?.tipo === "planes" && <PlanesIA planes={planes.planes} sucursales={sucursales} cerrar={() => setDialogo(null)} />}
```
(`BOTON` ya trae `bg-blue-600`; en Tailwind la clase que gane depende del orden del CSS. Si el botón sale azul, cambia a una constante propia `const BOTON_IA = "bg-violet-600 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50";` y úsala.)

- [ ] **Step 4: Verificar**

Run (uno por uno):
```bash
node --test src
npx eslint src backend
npm run build
```
Expected: todo verde, 0 errores de lint, build termina en "built in". Revisa que ninguna línea pase de 200 caracteres:
`grep -nE '.{201,}' src/metas/PlaneadorIA.jsx src/metas/PlanesIA.jsx src/metas/planIA.js backend/planIA*.js` → sin salida.

- [ ] **Step 5: Commit**

```bash
git add src/metas/PlaneadorIA.jsx src/metas/PlanesIA.jsx src/metas/AdministrarMetas.jsx
git commit -m "feat(planeador-ia): ventana de revision, registro de planes y origen en historial"
```

---

### Task 9: Verificación final (la hace Claude, no quien implementó)

- [ ] **Step 1: Suites, una por una**

```bash
cd backend && node --test planIADatos.test.js planIAValidar.test.js planIA.test.js planIACrear.test.js metasPlanIARutas.test.js
node --test metasPersonalizadas.test.js metasRutas.test.js metasPermisos.test.js metasCapturas.test.js metasSellos.test.js metasAvance.test.js
cd .. && node --test src && npx eslint src backend && npm run build
grep -rn "Ã" backend/planIA*.js src/metas/PlaneadorIA.jsx src/metas/PlanesIA.jsx src/metas/planIA.js   # sin salida
```

- [ ] **Step 2: Una llamada real a la IA (local, con la llave de `backend/.env`; cuesta centavos)**

Levantar backend y frontend del worktree, entrar como admin local, abrir Objetivos → Administración → Administrar metas extra, mes siguiente, "Vender más guitarras acústicas en Ocosingo". Confirmar: llega un borrador con 3–6 metas, o el mensaje de falla si la respuesta no pasa las reglas (en ese caso revisar `plan.error` en `GET /api/metas/plan-ia` y ajustar instrucciones; NO aflojar las validaciones sin preguntar a Victor).

- [ ] **Step 3: Navegador (Playwright, scripts del scratchpad)**

Con IA falsa (`app.locals.clienteIA` no se puede fijar desde fuera; usar la llamada real del paso 2 o, si falla, un backend local con `ANTHROPIC_API_KEY` vacía para ver el botón deshabilitado):
- Botón deshabilitado con el aviso cuando no hay llave.
- "Crear las validadas" deshabilitado hasta decidir todos los puntos.
- Cambiar una meta a persona muestra el aviso de "quedará fuera del OKR".
- Resumen del paso 3 correcto; "Confirmar" crea; el historial de la meta muestra "Origen: plan con IA · validado por …".
- "Planes con IA (N)" muestra lo propuesto contra lo aprobado.
- Celular (390 px): la ventana se lee sin scroll horizontal.
Apagar backend (4000) y vite (5173) al terminar.

- [ ] **Step 4: Reporte a Victor** en español: qué se verificó en navegador y qué solo en pruebas, costo de la llamada real, y pedir autorización para merge/push.
