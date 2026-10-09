# Metas personalizadas: pantallas — Implementation Plan (Entregas 2 y 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un módulo nuevo del menú, **"Metas y OKRs"**, con tres pestañas simples —Mis metas, Tablero, Administrar— sobre el servidor ya construido (`/api/metas/*`).

**Architecture:** Pantalla propia (no pestaña de "Mi Objetivo de Venta": esa está atada a un mes y una tienda, y estas metas son semanales, mensuales o trimestrales). Un contenedor `src/MetasOkrs.jsx` con un selector de periodo y `Pestanas`; cada pestaña es un componente en `src/metas/`. Toda la lógica que se puede probar sin navegador vive en funciones puras de `src/metas/metas.js` con sus pruebas `node --test`.

**Tech Stack:** React 18 + Tailwind (clases existentes `neu-campo`, `neu-boton`), lucide-react, `apiFetch` de `src/api.js`, `leer` de `src/objetivos/datos.js`, `Modal`/`Campo` de `src/objetivos/DialogosObjetivos.jsx`, `Pestanas` de `src/objetivos/Pestanas.jsx`, `BarraMeta` de `src/objetivos/GraficasAvance.jsx`.

**Spec:** `docs/superpowers/specs/2026-10-08-metas-personalizadas-design.md` (sección 7, ajustada por Victor el 2026-10-09: "algo intuitivo sin ser muy rebuscado"). Servidor: `docs/superpowers/plans/2026-10-08-metas-personalizadas-servidor.md`.

## Global Constraints

- Rama `feature/metas-personalizadas`, worktree `C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/metas-personalizadas`.
- **Diseño (Victor 2026-10-09): intuitivo, sin rebuscar.** Tres pestañas, textos cortos en español con acentos, un botón principal por acción, nada de menús escondidos. Computadora (no celular), pero sin scroll horizontal de página.
- Ninguna validación vive solo en pantalla: el servidor ya valida todo; la pantalla solo muestra el error que regresa (`leer`).
- Botones con `type="button"` o `type="submit"` explícito. Modales con scroll (usar `Modal` existente).
- Ninguna línea de más de 200 caracteres; clases Tailwind largas a constantes.
- Ninguna dependencia nueva. Commits sin acentos.
- Pruebas: `node --preserve-symlinks --preserve-symlinks-main --test <archivo>` desde la raíz. Build: `npm run build`. Eslint: `npx eslint src` con 0 errores.
- Fechas: `hoyLocal()` de `src/objetivos/datos.js` (hora de Chiapas).

## API disponible (ya construida y probada)

| Uso | Petición | Quién |
|---|---|---|
| Tablero | `GET /metas/tablero?periodo&inicio[&sucursal_id][&vendedor_id]` → `{ periodo, inicio, fin, sellado, okrs:[{clave,titulo,descripcion,alcance,sucursal_id,vendedor_id,porcentaje,metas:[AvanceMeta]}], sueltas:[AvanceMeta] }`; `AvanceMeta = { clave, okr_clave, nombre, descripcion, unidad, prueba, alcance, sucursal_id, vendedor_id, valor_meta, resultado, porcentaje, ritmo, semaforo, mis_capturas:[captura], por_persona?:[{vendedor_id,nombre,resultado}] }` | `usar_gerente_ventas` |
| Mi vendedor | `GET /gerente-ventas/mi/vendedor` → `{ vendedor_id }` | `usar_gerente_ventas` |
| Capturar | `POST /metas/:clave/captura` `{ fecha, link? , archivo?:{nombre_archivo,tipo_mime,contenido_base64}, cantidad?, nota? }` | `usar_gerente_ventas` |
| Anular | `POST /metas/captura/:id/anular` `{ motivo }` (propia o jefatura) | `usar_gerente_ventas` |
| Revisión | `GET /metas/revision?periodo&inicio` → capturas con `vendedor_nombre`, `meta_nombre`, `anulada` | `anular_capturas_metas` |
| Administrar | `GET /metas/admin?periodo&inicio` → `{ okrs, metas }` (todas las versiones, incluidas eliminadas) | `administrar_metas_personalizadas` |
| Crear/editar/eliminar | `POST /metas/okr`, `/metas/okr/:clave/editar`, `/metas/okr/:clave/retirar`, `POST /metas`, `/metas/:clave/editar`, `/metas/:clave/retirar`, `GET /metas/:clave/historial` | `administrar_metas_personalizadas` |
| Sellar | `GET /metas/sello/previo?periodo&inicio`, `POST /metas/sello {periodo,inicio}`, `POST /metas/sello/:id/rectificar {meta_clave,valor_nuevo,motivo}` | `administrar_metas_personalizadas` |
| Listas | `GET /sucursales`, `GET /vendedores` | — |

Falta en el servidor (Task 6 lo agrega): `GET /metas/sello?periodo&inicio` → el sello guardado (o 404) para ver rectificaciones y eliminadas de un periodo ya sellado.

## Review Focus

1. Vendedora sin vendedor ligado: "Mis metas" no aparece y el Tablero no truena (muestra el aviso de cuenta sin ligar).
2. Periodo sellado: no aparece "Hecho", ni "Anular", ni "Editar"/"Eliminar"; se ve el candado.
3. Liga repetida o foto repetida: el mensaje del servidor se muestra dentro del modal y el modal NO se cierra.
4. Cambiar de Semana a Trimestre conserva una fecha razonable: el periodo nuevo es el que contiene el inicio del anterior.
5. Doble clic en "Hecho"/"Guardar": una sola petición (bandera `enviando`).

---

### Task 1: funciones puras de periodos y formularios

**Files:**
- Create: `src/metas/metas.js`
- Test: `src/metas/metas.test.js`

**Interfaces (Produces):**
- `inicioDePeriodo(periodo, fecha) -> "AAAA-MM-DD"`, `finDePeriodo(periodo, inicio)`, `moverPeriodo(periodo, inicio, pasos) -> inicio`, `etiquetaPeriodo(periodo, inicio) -> texto`, `periodoTerminado(periodo, inicio, hoy) -> bool`.
- `COLOR_SEMAFORO = { verde, amarillo, rojo }` (clases Tailwind), `TEXTO_PRUEBA = { ninguna: "Sin prueba", liga: "Liga de la publicación", foto: "Foto" }`.
- `cuerpoMeta(form) -> objeto para POST /metas` (convierte `valor_meta` y ids a número; omite `okr_clave` vacío; para alcance empresa manda `participantes` como números).
- `cuerpoCaptura(meta, form) -> objeto para POST /metas/:clave/captura` (liga → `{fecha, link}`; foto → `{fecha, archivo}`; ninguna → `{fecha, cantidad: Number}`; `nota` solo si no está vacía).

- [ ] **Step 1: Pruebas que fallan** (`src/metas/metas.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { inicioDePeriodo, finDePeriodo, moverPeriodo, etiquetaPeriodo, periodoTerminado, cuerpoMeta, cuerpoCaptura } from "./metas.js";

test("periodos iguales a los del servidor", () => {
  assert.equal(inicioDePeriodo("semanal", "2026-10-11"), "2026-10-05");
  assert.equal(finDePeriodo("semanal", "2026-10-05"), "2026-10-11");
  assert.equal(inicioDePeriodo("mensual", "2026-10-15"), "2026-10-01");
  assert.equal(finDePeriodo("mensual", "2028-02-01"), "2028-02-29");
  assert.equal(inicioDePeriodo("trimestral", "2026-08-15"), "2026-07-01");
  assert.equal(finDePeriodo("trimestral", "2026-10-01"), "2026-12-31");
});

test("mover periodos hacia atrás y adelante, cruzando el año", () => {
  assert.equal(moverPeriodo("semanal", "2026-10-05", -1), "2026-09-28");
  assert.equal(moverPeriodo("mensual", "2026-12-01", 1), "2027-01-01");
  assert.equal(moverPeriodo("trimestral", "2026-01-01", -1), "2025-10-01");
});

test("etiquetas legibles", () => {
  assert.equal(etiquetaPeriodo("semanal", "2026-10-05"), "Semana del 5 al 11 de octubre de 2026");
  assert.equal(etiquetaPeriodo("semanal", "2026-09-28"), "Semana del 28 de septiembre al 4 de octubre de 2026");
  assert.equal(etiquetaPeriodo("mensual", "2026-10-01"), "Octubre de 2026");
  assert.equal(etiquetaPeriodo("trimestral", "2026-10-01"), "Trimestre octubre–diciembre de 2026");
});

test("un periodo termina el día después de su fin", () => {
  assert.equal(periodoTerminado("semanal", "2026-10-05", "2026-10-11"), false);
  assert.equal(periodoTerminado("semanal", "2026-10-05", "2026-10-12"), true);
});

test("cuerpo de la meta según alcance", () => {
  const base = { nombre: " Videos ", unidad: "videos", prueba: "liga", valor_meta: "12", periodo: "mensual", inicio: "2026-10-01" };
  assert.deepEqual(cuerpoMeta({ ...base, alcance: "tienda", sucursal_id: "4", okr_clave: "" }),
    { nombre: " Videos ", descripcion: undefined, unidad: "videos", prueba: "liga", valor_meta: 12, periodo: "mensual",
      inicio: "2026-10-01", alcance: "tienda", sucursal_id: 4 });
  assert.deepEqual(cuerpoMeta({ ...base, alcance: "persona", vendedor_id: "2" }).vendedor_id, 2);
  assert.deepEqual(cuerpoMeta({ ...base, alcance: "empresa", participantes: ["3", "1"] }).participantes, [3, 1]);
  assert.deepEqual(cuerpoMeta({ ...base, okr_clave: "7" }), { nombre: " Videos ", descripcion: undefined, unidad: "videos",
    prueba: "liga", valor_meta: 12, okr_clave: 7 });
});

test("cuerpo de la captura según la prueba de la meta", () => {
  const archivo = { nombre_archivo: "a.jpg", tipo_mime: "image/jpeg", contenido_base64: "eA==" };
  assert.deepEqual(cuerpoCaptura({ prueba: "liga" }, { fecha: "2026-10-08", link: "https://x.com/1", nota: "  " }),
    { fecha: "2026-10-08", link: "https://x.com/1" });
  assert.deepEqual(cuerpoCaptura({ prueba: "foto" }, { fecha: "2026-10-08", archivo, nota: "Tienda" }),
    { fecha: "2026-10-08", archivo, nota: "Tienda" });
  assert.deepEqual(cuerpoCaptura({ prueba: "ninguna" }, { fecha: "2026-10-08", cantidad: "5" }), { fecha: "2026-10-08", cantidad: 5 });
});
```

- [ ] **Step 2:** `node --preserve-symlinks --preserve-symlinks-main --test src/metas/metas.test.js` → FAIL (módulo no existe).

- [ ] **Step 3: Implementar** `src/metas/metas.js`

```js
// Funciones puras de la pantalla de Metas y OKRs. Los periodos son los MISMOS que valida el
// servidor (backend/metasPeriodos.js): semana de lunes a domingo, mes y trimestre de calendario.
const DIA_MS = 24 * 60 * 60 * 1000;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const aUTC = (fecha) => { const [a, m, d] = fecha.split("-").map(Number); return new Date(Date.UTC(a, m - 1, d)); };
const aTexto = (fecha) => fecha.toISOString().slice(0, 10);
const partes = (fecha) => { const d = aUTC(fecha); return { dia: d.getUTCDate(), mes: d.getUTCMonth(), anio: d.getUTCFullYear() }; };

export const COLOR_SEMAFORO = { verde: "bg-emerald-500", amarillo: "bg-amber-400", rojo: "bg-red-500" };
export const TEXTO_SEMAFORO = { verde: "Vas a tiempo", amarillo: "Un poco atrás", rojo: "Muy atrás" };
export const TEXTO_PRUEBA = { ninguna: "Sin prueba", liga: "Liga de la publicación", foto: "Foto" };
export const TEXTO_PERIODO = { semanal: "Semana", mensual: "Mes", trimestral: "Trimestre" };

export function inicioDePeriodo(periodo, fecha) {
  const d = aUTC(fecha);
  if (periodo === "semanal") return aTexto(new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DIA_MS));
  const mes = periodo === "mensual" ? d.getUTCMonth() : d.getUTCMonth() - (d.getUTCMonth() % 3);
  return aTexto(new Date(Date.UTC(d.getUTCFullYear(), mes, 1)));
}

export function finDePeriodo(periodo, inicio) {
  const d = aUTC(inicio);
  if (periodo === "semanal") return aTexto(new Date(d.getTime() + 6 * DIA_MS));
  const meses = periodo === "mensual" ? 1 : 3;
  return aTexto(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + meses, 0)));
}

export function moverPeriodo(periodo, inicio, pasos) {
  const d = aUTC(inicio);
  if (periodo === "semanal") return aTexto(new Date(d.getTime() + pasos * 7 * DIA_MS));
  const meses = (periodo === "mensual" ? 1 : 3) * pasos;
  return aTexto(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + meses, 1)));
}

export function etiquetaPeriodo(periodo, inicio) {
  const a = partes(inicio);
  const b = partes(finDePeriodo(periodo, inicio));
  if (periodo === "mensual") return `${MESES[a.mes][0].toUpperCase()}${MESES[a.mes].slice(1)} de ${a.anio}`;
  if (periodo === "trimestral") return `Trimestre ${MESES[a.mes]}–${MESES[b.mes]} de ${a.anio}`;
  if (a.mes === b.mes) return `Semana del ${a.dia} al ${b.dia} de ${MESES[a.mes]} de ${a.anio}`;
  const anioA = a.anio === b.anio ? "" : ` de ${a.anio}`;
  return `Semana del ${a.dia} de ${MESES[a.mes]}${anioA} al ${b.dia} de ${MESES[b.mes]} de ${b.anio}`;
}

export const periodoTerminado = (periodo, inicio, hoy) => hoy > finDePeriodo(periodo, inicio);

export function cuerpoMeta(form) {
  const comun = { nombre: form.nombre, descripcion: form.descripcion || undefined, unidad: form.unidad, prueba: form.prueba,
    valor_meta: Number(form.valor_meta) };
  if (form.okr_clave) return { ...comun, okr_clave: Number(form.okr_clave) };
  const base = { ...comun, periodo: form.periodo, inicio: form.inicio, alcance: form.alcance };
  if (form.alcance === "tienda") return { ...base, sucursal_id: Number(form.sucursal_id) };
  if (form.alcance === "persona") return { ...base, vendedor_id: Number(form.vendedor_id) };
  return { ...base, participantes: (form.participantes || []).map(Number) };
}

export function cuerpoCaptura(meta, form) {
  const nota = form.nota?.trim() ? { nota: form.nota.trim() } : {};
  if (meta.prueba === "liga") return { fecha: form.fecha, link: form.link, ...nota };
  if (meta.prueba === "foto") return { fecha: form.fecha, archivo: form.archivo, ...nota };
  return { fecha: form.fecha, cantidad: Number(form.cantidad), ...nota };
}
```

- [ ] **Step 4:** mismo comando → PASS.
- [ ] **Step 5: Commit** (Claude): `feat(metas): funciones de periodos y formularios para la pantalla`

---

### Task 2: módulo en el menú y contenedor con selector de periodo

**Files:**
- Modify: `src/menuCategorias.js` (categoría `comercial`, después de `gerencia_ventas`)
- Modify: `src/menuCategorias.test.js` (el conteo del administrador pasa de 16 a 17; agregar prueba del módulo nuevo)
- Modify: `src/App.jsx` (`MODULOS` línea ~24 y la vista, junto a `gerencia_ventas` línea ~161)
- Modify: `src/BarraLateral.jsx` (`ICONOS`: `metas_okrs: Flag` importando `Flag` de lucide-react)
- Modify: `src/EncabezadoModulo.jsx` (`metas_okrs: "Metas y OKRs"`)
- Create: `src/MetasOkrs.jsx`

**Interfaces:**
- Produces: `MetasOkrs({ permisos, usuario })`. Estado compartido que pasa a cada pestaña: `{ periodo, inicio, hoy, sucursales, vendedores, miVendedorId, permisos }`.

- [ ] **Step 1: Prueba que falla** — agregar a `src/menuCategorias.test.js`:

```js
test("Metas y OKRs se ve con cualquiera de sus tres permisos y no sin ellos", () => {
  const modulo = CATEGORIAS.flatMap((c) => c.modulos).find((m) => m.id === "metas_okrs");
  assert.ok(modulo, "existe en el menú");
  for (const permiso of ["usar_gerente_ventas", "administrar_metas_personalizadas", "anular_capturas_metas"]) {
    assert.equal(moduloVisible(modulo, { modulos: ["pos"], permisos: [permiso] }), true, permiso);
  }
  assert.equal(moduloVisible(modulo, { modulos: ["pos"], permisos: ["realizar_corte_caja"] }), false);
});
```

y cambiar en la prueba "el administrador ve las tres categorías y los 16 módulos" el 16 por 17 (y el título). Correr: `node --preserve-symlinks --preserve-symlinks-main --test src/menuCategorias.test.js` → FAIL.

- [ ] **Step 2: Implementar**

`src/menuCategorias.js`, después de la entrada `gerencia_ventas`:

```js
      { id: "metas_okrs", nombre: "Metas y OKRs", modulo: "pos",
        permiso: ["usar_gerente_ventas", "administrar_metas_personalizadas", "anular_capturas_metas"] },
```

`src/App.jsx`: agregar `"metas_okrs"` a `MODULOS` e `import MetasOkrs from "./MetasOkrs.jsx";`, y junto a la vista de `gerencia_ventas`:

```jsx
        {vista === "metas_okrs" && (
          <MetasOkrs permisos={usuario.permisos} usuario={usuario} />
        )}
```

`src/MetasOkrs.jsx` — contenedor. Comportamiento exacto:
- Al montar: `GET /gerente-ventas/mi/vendedor` (solo si tiene `usar_gerente_ventas`; si falla, `miVendedorId = null`), `GET /sucursales`, y `GET /vendedores` solo si tiene `administrar_metas_personalizadas` o `anular_capturas_metas`. Errores con `leer` en un `role="alert"` rojo como en `GerenciaVentas.jsx`.
- Estado `periodo` (inicial `"mensual"`) e `inicio` (inicial `inicioDePeriodo("mensual", hoyLocal())`).
- **Selector de periodo** (una fila, arriba):
  - Tres botones tipo segmento: "Semana", "Mes", "Trimestre" (`TEXTO_PERIODO`); el activo en azul (`aria-pressed`). Al cambiar: `setInicio(inicioDePeriodo(nuevo, inicio))`.
  - Botón `‹` (`aria-label="Periodo anterior"`), la etiqueta `etiquetaPeriodo(periodo, inicio)` en negritas, botón `›` (`aria-label="Periodo siguiente"`), y un botón "Hoy" que regresa al periodo de `hoyLocal()`.
- **Pestañas** con `Pestanas` existente (`import Pestanas from "./objetivos/Pestanas"`), en este orden y solo si aplica:
  - `mis-metas` "Mis metas" (icono `CheckSquare`) — si `miVendedorId != null`.
  - `tablero` "Tablero" (icono `BarChart3`) — siempre.
  - `administrar` "Administrar" (icono `Settings2`) — si tiene `administrar_metas_personalizadas`.
  - La pestaña inicial es la primera disponible; se conserva al cambiar de periodo.
- Si tiene `usar_gerente_ventas`, no es jefatura y `miVendedorId == null`: aviso ámbar "Tu cuenta no tiene un vendedor ligado. Pídele a quien administra el personal que la ligue desde Roles y Personal."
- Cada pestaña recibe `key={`${periodo}/${inicio}`}` para recargarse al cambiar de periodo.

Hasta que existan las Tasks 3-5, las pestañas renderizan un `<p>` provisional con el nombre; las Tasks siguientes los reemplazan.

- [ ] **Step 3:** `node --preserve-symlinks --preserve-symlinks-main --test src/menuCategorias.test.js` → PASS; `npm run build` OK.
- [ ] **Step 4: Commit** (Claude): `feat(metas): modulo Metas y OKRs con selector de periodo`

---

### Task 3: pestaña "Mis metas" (la vendedora marca Hecho)

**Files:**
- Modify: `backend/metasAvance.js`, `backend/metasAvance.test.js` (campo `puede_capturar`)
- Create: `src/metas/MisMetas.jsx`
- Modify: `src/MetasOkrs.jsx` (renderizar `MisMetas` en la pestaña)

**Interfaces:**
- Consumes: `GET /metas/tablero` (con el `vendedor_id` propio NO como filtro: el servidor ya recorta por cuenta), `POST /metas/:clave/captura`, `POST /metas/captura/:id/anular`, `cuerpoCaptura`, `TEXTO_PRUEBA`, `hoyLocal`, `leer`, `Modal`, `Campo`.
- Props: `MisMetas({ periodo, inicio, hoy, sellado? })`.

**Paso de servidor primero (TDD):** una gerente que también vende ve en el tablero TODAS las metas de su tienda,
incluidas las personales de sus compañeras; "Mis metas" debe mostrar solo las que ella puede capturar. Agregar a
cada `AvanceMeta` el campo `puede_capturar` en `backend/metasAvance.js` (`avanceMeta`):

```js
function puedeCapturar(DB, meta, vendedor_id) {
  if (vendedor_id === null || vendedor_id === undefined) return false;
  if (meta.alcance === "persona") return meta.vendedor_id === vendedor_id;
  if (meta.alcance === "empresa") return meta.participantes.includes(vendedor_id);
  return DB.pos.vendedores.find((v) => v.id === vendedor_id)?.sucursal_id === meta.sucursal_id;
}
// en avanceMeta: puede_capturar: puedeCapturar(DB, meta, visor.vendedor_id),
```

Prueba (al final de `backend/metasAvance.test.js`), primero en rojo:

```js
test("puede_capturar: la gerente que vende no puede capturar la meta personal de su compañera", () => {
  const DB = DBPrueba();
  const tienda = M.crearMeta(DB, { ...BASE, nombre: "Videos", unidad: "videos", prueba: "ninguna", valor_meta: 12, alcance: "tienda", sucursal_id: 4 }, VICTOR);
  M.crearMeta(DB, { ...BASE, nombre: "De Luis", unidad: "x", prueba: "ninguna", valor_meta: 1, alcance: "persona", vendedor_id: 2 }, VICTOR);
  const gerenteQueVende = { vendedor_id: 1, jefatura: true, verTodas: false, sucursalId: 4 };
  const t = tablero(DB, gerenteQueVende, BASE, "2026-10-15");
  assert.deepEqual(t.sueltas.map((m) => [m.nombre, m.puede_capturar]), [["Videos", true], ["De Luis", false]]);
  assert.ok(tienda);
});
```

(El servidor YA rechaza la captura ajena; esto solo evita mostrar un botón que va a fallar.) Correr
`node --preserve-symlinks --preserve-symlinks-main --test metasAvance.test.js` desde `backend/` → PASS. Commit (Claude):
`feat(metas): el tablero dice si quien lo ve puede capturar cada meta`.

Comportamiento exacto (un solo listado, como una lista de pendientes):
- Carga `GET /metas/tablero?periodo=…&inicio=…`; junta `okrs[].metas` y `sueltas` en una lista (agrupadas bajo el título del OKR cuando lo tengan) y **muestra solo las que tienen `puede_capturar: true`**.
- Cada meta es una tarjeta: nombre en negritas, "8 de 12 videos" (`resultado` de `valor_meta` `unidad`), barra de avance (`BarraMeta` existente con `titulo` vacío o una barra simple), punto de color del semáforo con `TEXTO_SEMAFORO`, y debajo "Tú llevas N" (suma de `mis_capturas[].cantidad`). Si `alcance` es "tienda" muestra la etiqueta "De la tienda"; "persona" → "Tuya"; "empresa" → "De toda la empresa".
- Botón grande azul **"Hecho"** a la derecha de cada tarjeta. No aparece si `sellado`.
- Al presionar "Hecho" se abre `Modal` "¿Qué hiciste?":
  - Fecha (`input type="date"`, por omisión `hoy`, `max` = `hoy`, `min` = `inicio`).
  - Según `prueba`: liga → campo "Pega la liga de la publicación" (`type="url"`); foto → `input type="file" accept="image/jpeg,image/png"`, leído con una función `leerArchivoComoBase64` copiada de `src/Gastos.jsx:25`; ninguna → "¿Cuántas?" (`type="number" min=1`).
  - Nota opcional.
  - Botón "Guardar" deshabilitado mientras `enviando` o falte la liga/foto/cantidad. Si el servidor responde error (liga repetida, fuera de periodo…) se muestra DENTRO del modal y el modal no se cierra. Al guardar: cerrar, recargar y mostrar "¡Listo! Se registró."
- Debajo de cada tarjeta, enlace "Ver lo que capturé (N)" que despliega `mis_capturas`: fecha, liga clicable (`target="_blank" rel="noreferrer"`) o "Foto" (enlace a `evidencia.drive_link`) o "N", y si `anulada` el renglón tachado con "Anulada por X: motivo". Botón "Quitar" en las no anuladas (solo si no está sellado) que pide motivo en un `Modal` y llama `POST /metas/captura/:id/anular`.
- Sin metas: "No tienes metas en este periodo."

- [ ] **Step 1:** Verificar con `npm run build` (compila) y `npx eslint src/metas src/MetasOkrs.jsx` (0 errores). (Las reglas de negocio ya las prueban el servidor y `cuerpoCaptura`; esta pantalla se verifica en navegador al final.)
- [ ] **Step 2: Commit** (Claude): `feat(metas): pestana Mis metas con boton Hecho`

---

### Task 4: pestaña "Tablero" (con la revisión adentro)

**Files:**
- Create: `src/metas/TableroMetas.jsx`
- Modify: `src/MetasOkrs.jsx`

**Interfaces:**
- Consumes: `GET /metas/tablero` (con `sucursal_id`/`vendedor_id` opcionales), `GET /metas/revision` (solo con `anular_capturas_metas`), `POST /metas/captura/:id/anular`, `COLOR_SEMAFORO`, `TEXTO_SEMAFORO`, `BarraMeta`.
- Props: `TableroMetas({ periodo, inicio, permisos, sucursales, vendedores })`.

Comportamiento exacto:
- Filtros arriba, solo si hay listas (jefatura): "Tienda" (`select`, "Todas") y "Persona" (`select`, "Todas"). Cambiar filtro recarga.
- Si `sellado`: franja gris "🔒 Periodo sellado. Ya no se puede capturar ni quitar nada."
- **Una tarjeta por OKR**: título, descripción en gris, a la derecha el porcentaje grande del OKR (`porcentaje` o "—") y una barra; dentro, un renglón por meta con `BarraMeta` (`titulo` = nombre, `porcentaje`, `detalle` = "8 de 12 videos") y el punto de semáforo. Las metas sin OKR van en una tarjeta final "Otras metas".
- **Clic en un renglón de meta** lo despliega (solo jefatura, es decir si trae `por_persona`):
  - Tabla "Por persona" (`nombre`, `resultado`).
  - Si tiene `anular_capturas_metas`: lista "Lo que capturaron" desde `GET /metas/revision` filtrada por `meta_clave`: fecha, persona, liga clicable / foto / cantidad, y botón "Anular" (pide motivo con `Modal`; no aparece si `sellado` o si ya está anulada; las anuladas tachadas con quién y motivo).
- Sin metas: "No hay metas en este periodo." y, si es administrador, "Créalas en la pestaña Administrar."

- [ ] **Step 1:** `npm run build` y `npx eslint src/metas` (0 errores).
- [ ] **Step 2: Commit** (Claude): `feat(metas): tablero de okrs y metas con revision de capturas`

---

### Task 5: pestaña "Administrar" (crear, editar, eliminar e historial)

**Files:**
- Create: `src/metas/AdministrarMetas.jsx`
- Modify: `src/MetasOkrs.jsx`

**Interfaces:**
- Consumes: `GET /metas/admin`, `POST /metas/okr`, `/metas/okr/:clave/editar`, `/metas/okr/:clave/retirar`, `POST /metas`, `/metas/:clave/editar`, `/metas/:clave/retirar`, `GET /metas/:clave/historial`, `cuerpoMeta`, `TEXTO_PRUEBA`.
- Props: `AdministrarMetas({ periodo, inicio, hoy, sucursales, vendedores, alSellar })` (`alSellar` lo usa la Task 6).

Comportamiento exacto:
- Dos botones arriba: **"+ Nuevo OKR"** y **"+ Nueva meta"**. Si el periodo está sellado, no aparecen (mensaje "Periodo sellado").
- **Nuevo OKR** (`Modal`): Título, Descripción (opcional), "¿Para quién?" con tres opciones en botones tipo segmento: "Una tienda" / "Una persona" / "Toda la empresa"; según la elección, `select` de tienda, `select` de persona, o casillas de participantes. El periodo es el que está seleccionado arriba (se muestra la etiqueta, no se edita).
- **Nueva meta** (`Modal`): "¿Pertenece a un OKR?" (`select` con "Ninguno" + OKRs vigentes del periodo); Nombre ("Ej. Videos de tips"); Unidad ("Ej. videos, reseñas, visitas"); Cifra meta (número entero); "¿Qué prueba pide?" con tres botones tipo segmento: "Liga" / "Foto" / "Sin prueba" (`TEXTO_PRUEBA`); si no tiene OKR, el mismo "¿Para quién?" del OKR. Enviar `cuerpoMeta(form)` con `periodo` e `inicio` del selector.
- **Lista**: una tarjeta por OKR con sus metas debajo, y "Otras metas". Cada renglón vigente muestra nombre, cifra, unidad, prueba y para quién, con tres acciones de texto: "Editar", "Historial", "Eliminar".
  - **Editar** (`Modal`): nombre, unidad, prueba y cifra precargados + **Motivo (obligatorio)**. Envía solo lo que cambió + `motivo`. (Para OKR: título y descripción + motivo.)
  - **Eliminar** (`Modal`): explica "Deja de contar desde hoy. Queda en el historial con tu nombre y el motivo." + **Motivo (obligatorio)**. Para OKR agrega: "También se eliminan sus N metas."
  - **Historial** (`Modal`): versiones de `GET /metas/:clave/historial`: "Versión N: cifra unidad — Nombre", quién y cuándo, motivo, y si tiene `retirada`, en rojo "Eliminada por X · fecha · Motivo: …" (mismo estilo que `RetiradaMeta` de `DialogosObjetivos.jsx`).
- **Eliminadas siguen a la vista** (decisión de Victor 2026-10-08): debajo, sección plegable "Eliminadas en este periodo (N)" con las metas y OKRs que tienen `retirada`: nombre tachado, quién, cuándo y motivo, y su "Historial".

- [ ] **Step 1:** `npm run build` y `npx eslint src/metas` (0 errores).
- [ ] **Step 2: Commit** (Claude): `feat(metas): administrar okrs y metas con historial y eliminadas`

---

### Task 6: sellar el periodo y ver lo sellado

**Files:**
- Modify: `backend/metasRutas.js` (ruta `GET /api/metas/sello`, junto a `/api/metas/sello/previo`)
- Test: `backend/metasRutas.test.js` (al final)
- Create: `src/metas/SelloMetas.jsx`
- Modify: `src/metas/AdministrarMetas.jsx` (mostrar `SelloMetas` arriba)

**Interfaces:**
- Produces: `GET /api/metas/sello?periodo&inicio` (admin) → el sello completo o 404 `{ error: "Sello no encontrado" }`.

- [ ] **Step 1: Prueba que falla** (al final de `backend/metasRutas.test.js`):

```js
test("ver el sello de un periodo: 404 si no existe, completo si existe; solo admin", async () => {
  estado(await pedir("GET", `/api/metas/sello?${consulta}`, admin), 404);
  const meta = await crearMeta({ ...META, prueba: "ninguna" });
  estado(await pedir("POST", `/api/metas/${meta.clave}/retirar`, admin, { motivo: "No aplica" }), 200);
  estado(await pedir("POST", "/api/metas/sello", admin, SEMANA), 200);
  const r = await pedir("GET", `/api/metas/sello?${consulta}`, admin);
  estado(r, 200);
  assert.deepEqual(r.cuerpo.foto.retiradas.map((m) => m.retirada.motivo), ["No aplica"]);
  estado(await pedir("GET", `/api/metas/sello?${consulta}`, gerente), 403);
});
```

Correr `node --preserve-symlinks --preserve-symlinks-main --test metasRutas.test.js` (desde `backend/`) → FAIL.

- [ ] **Step 2: Implementar** en `backend/metasRutas.js`, ANTES de `/api/metas/sello/previo`:

```js
  app.get("/api/metas/sello", requiereLogin, admin, (req, res) => {
    const sello = DB.pos.meta_sellos.find((s) => s.periodo === req.query.periodo && s.inicio === req.query.inicio);
    if (!sello) return res.status(404).json({ error: "Sello no encontrado" });
    res.json(sello);
  });
```

(La foto incluye capturas con `drive_file_id`: quitarlo con `capturaParaRespuesta` en `foto.capturas` antes de responder.) Correr → PASS.

- [ ] **Step 3: Pantalla** `src/metas/SelloMetas.jsx` — props `{ periodo, inicio, hoy, alCambiar }`:
  - Si `!periodoTerminado(periodo, inicio, hoy)`: no muestra nada.
  - Si terminó y no está sellado (`GET /metas/sello` → 404): franja ámbar "Este periodo ya terminó. Revisa los resultados y séllalo." con botón **"Revisar y sellar"** → `Modal` con la tabla de `GET /metas/sello/previo` (meta, para quién, resultado de cifra, %), aviso "Después de sellar ya no se puede capturar, quitar ni cambiar nada; solo corregir el resultado con motivo." y botón **"Sellar"** (`POST /metas/sello`). Al terminar: `alCambiar()`.
  - Si está sellado: franja gris "🔒 Sellado por X el fecha", tabla de resultados con el valor vigente (última rectificación, el original tachado si cambió) y botón "Corregir" por renglón → `Modal` con número y **Motivo** → `POST /metas/sello/:id/rectificar`. Debajo, "Eliminadas en este periodo" con `foto.retiradas` y `foto.okrs_retirados` (nombre tachado, quién, cuándo, motivo).
- [ ] **Step 4:** `npm run build`, `npx eslint src/metas backend/metasRutas.js` (0 errores).
- [ ] **Step 5: Commit** (Claude): `feat(metas): sellar periodo y ver lo sellado desde Administrar`

---

## Verificación final (Claude)

- Suite completa backend y `src` en verde; build; eslint 0 errores; ninguna línea > 200.
- Navegador con copia local (Playwright de la caché si la extensión de Chrome no conecta), en este orden:
  1. Admin: crear OKR "Redes Palenque" (tienda) con metas "Videos de tips" (liga, 12) y "Reseñas" (liga, 30), y una meta suelta "Llamadas" (sin prueba, 20).
  2. Vendedora ligada: Mis metas → Hecho con liga de TikTok → aparece "1 de 12"; misma liga con `?utm_source` → mensaje dentro del modal; Llamadas → 5.
  3. Gerente: Tablero → abre "Videos de tips" → ve a la vendedora y anula con motivo.
  4. Admin: editar cifra con motivo, eliminar "Reseñas" con motivo → sale en "Eliminadas" con historial.
  5. Semana pasada: Revisar y sellar → candado; Hecho/Anular/Editar desaparecen; Corregir resultado con motivo.
- Producción (anotar para el merge): dar `anular_capturas_metas` al rol Gerente en Roles y Personal.
