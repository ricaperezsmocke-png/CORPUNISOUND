# Eliminar (retirar) metas fijas — Implementation Plan (Entrega 0.5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el administrador/gerente pueda eliminar una meta de Objetivos (venta, marca, producto, crédito, actividad, inventario) con motivo, sin borrarla del registro.

**Architecture:** "Eliminar" marca la versión vigente como `vigente:false` con un bloque `retirada {por_id, por_nombre, en, motivo}` y no crea versión nueva. Todos los consumidores ya filtran por `vigente`, así que la meta desaparece de avance, reparto y cierre sin tocarlos; las capturas siguen y en el cierre salen con meta 0. Se corrige la foto "al corte de ayer" para que respete la retirada, y `fijarObjetivo` para que volver a fijar continúe la numeración de versiones.

**Tech Stack:** Node/Express (CommonJS), `node:test`, React 18 + Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-08-metas-personalizadas-design.md` (sección 6).

## Global Constraints

- Rama `feature/metas-personalizadas`, worktree `C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/metas-personalizadas`, base `f52aaa2`.
- Solo en mes ABIERTO (`validarMesObjetivosAbierto`, `backend/server.js:2399`). Motivo obligatorio, no vacío tras `trim()`.
- Permiso: `editar_objetivos_venta` + `sucursalObjetivosPermitida` (sucursal ajena = 404, como las demás rutas).
- Nunca borrar registros de `DB.pos.objetivos`.
- Ninguna dependencia nueva. Acentos sí en código/pantalla; mensajes de commit SIN acentos.
- Correr pruebas SIEMPRE con: `node --preserve-symlinks --preserve-symlinks-main --test <archivo>` desde `backend/` (o desde la raíz para `src/`).

## Review Focus

1. Retirar la meta de TIENDA (vendedor_id null) mientras hay metas por persona: la sugerencia de reparto no debe romper (meta de tienda ausente = 0).
2. Retirar hoy y consultar el % de tienda de la vendedora (foto al corte de ayer): ayer la meta existía, debe seguir contando hasta mañana.
3. Retirar y volver a fijar: versión 3 (no 1), `reemplaza_a` apunta a la retirada, el historial muestra las tres.
4. Retirar dos veces la misma meta: 400 "No hay meta vigente que eliminar".
5. Retirar una meta de marca desactivada con capturas: el cierre sigue mostrando la marca con meta 0 y su capturado.

---

### Task 1: `retirarObjetivo` y versiones continuas

**Files:**
- Modify: `backend/objetivos.js` (función nueva después de `fijarObjetivo`, línea ~112; `fijarObjetivo` líneas 95-110; exports línea ~263)
- Test: `backend/objetivos.test.js` (al final)

**Interfaces:**
- Produces: `retirarObjetivo(DB, datos, usuario) -> registroRetirado` donde `datos` = llave de meta (`tipo, mes, sucursal_id, vendedor_id` + referencia) + `motivo`; `usuario` = `{ id, nombre }`.

- [ ] **Step 1: Pruebas que fallan** (al final de `backend/objetivos.test.js`)

```js
const { retirarObjetivo } = require("./objetivos");
const LLAVE_VENTA = { tipo: "venta", mes: "2026-10", sucursal_id: 1, vendedor_id: 1 };

test("retirar deja la meta sin vigente, con quién, cuándo y motivo, y sin borrarla", () => {
  const DB = prepararDB();
  fijarObjetivo(DB, { ...LLAVE_VENTA, monto: 5000 }, VICTOR);
  const retirada = retirarObjetivo(DB, { ...LLAVE_VENTA, motivo: "Se fue de la tienda" }, VICTOR);
  assert.strictEqual(objetivoVigente(DB, LLAVE_VENTA), null);
  assert.strictEqual(DB.pos.objetivos.length, 1);
  assert.strictEqual(retirada.vigente, false);
  assert.strictEqual(retirada.retirada.motivo, "Se fue de la tienda");
  assert.strictEqual(retirada.retirada.por_id, 1);
  assert.strictEqual(retirada.retirada.por_nombre, "Victor");
  assert.ok(!Number.isNaN(Date.parse(retirada.retirada.en)));
});

test("retirar exige motivo y una meta vigente", () => {
  const DB = prepararDB();
  assert.throws(() => retirarObjetivo(DB, { ...LLAVE_VENTA, motivo: "x" }, VICTOR), /No hay meta vigente que eliminar/);
  fijarObjetivo(DB, { ...LLAVE_VENTA, monto: 5000 }, VICTOR);
  assert.throws(() => retirarObjetivo(DB, { ...LLAVE_VENTA, motivo: "   " }, VICTOR), /motivo/);
  retirarObjetivo(DB, { ...LLAVE_VENTA, motivo: "ok" }, VICTOR);
  assert.throws(() => retirarObjetivo(DB, { ...LLAVE_VENTA, motivo: "otra vez" }, VICTOR), /No hay meta vigente que eliminar/);
});

test("volver a fijar tras retirar continúa la versión y encadena con la retirada", () => {
  const DB = prepararDB();
  fijarObjetivo(DB, { ...LLAVE_VENTA, monto: 5000 }, VICTOR);
  fijarObjetivo(DB, { ...LLAVE_VENTA, monto: 6000, motivo: "sube" }, VICTOR);
  const retirada = retirarObjetivo(DB, { ...LLAVE_VENTA, motivo: "error" }, VICTOR);
  const nueva = fijarObjetivo(DB, { ...LLAVE_VENTA, monto: 4000, motivo: "vuelve" }, VICTOR);
  assert.strictEqual(nueva.version, 3);
  assert.strictEqual(nueva.reemplaza_a, retirada.id);
  assert.deepStrictEqual(historialObjetivo(DB, LLAVE_VENTA).map((o) => o.version), [1, 2, 3]);
  assert.strictEqual(objetivoVigente(DB, LLAVE_VENTA).monto, 4000);
});

test("retirar la meta de tienda no toca las de las personas", () => {
  const DB = prepararDB();
  fijarObjetivo(DB, { ...LLAVE_VENTA, vendedor_id: null, monto: 10000 }, VICTOR);
  fijarObjetivo(DB, { ...LLAVE_VENTA, monto: 5000 }, VICTOR);
  retirarObjetivo(DB, { ...LLAVE_VENTA, vendedor_id: null, motivo: "rehacer" }, VICTOR);
  assert.strictEqual(objetivoVigente(DB, { ...LLAVE_VENTA, vendedor_id: null }), null);
  assert.strictEqual(objetivoVigente(DB, LLAVE_VENTA).monto, 5000);
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run (desde `backend/`): `node --preserve-symlinks --preserve-symlinks-main --test objetivos.test.js`
Expected: FAIL — `retirarObjetivo is not a function`.

- [ ] **Step 3: Implementar** en `backend/objetivos.js`

En `fijarObjetivo`, reemplazar el cálculo de `anterior`/`nuevo` (líneas 95-106) para que la versión y `reemplaza_a` sigan la cadena aunque no haya vigente:

```js
  const anterior = objetivoVigente(DB, llave);
  // Tras retirar no hay vigente, pero la cadena sigue: la versión nueva continúa la numeración
  // y apunta a la última, para que el historial y la foto "al corte" la lean completa.
  const ultima = historialObjetivo(DB, llave).at(-1) || null;
  const nuevo = {
    id: DB.pos.objetivos.reduce((maximo, o) => Math.max(maximo, o.id), 0) + 1,
    ...llave,
    monto,
    version: ultima ? ultima.version + 1 : 1,
    vigente: true,
    creado_por: usuario?.nombre || "desconocido",
    creado_en: new Date().toISOString(),
    reemplaza_a: ultima ? ultima.id : null,
    motivo: motivo ?? null,
  };
```

(El resto de `fijarObjetivo` queda igual: `if (anterior) anterior.vigente = false; DB.pos.objetivos.push(nuevo);`.)

Función nueva justo después de `fijarObjetivo`:

```js
// Eliminar una meta = retirarla (decisión de Victor 2026-10-08). No se borra: si se pudiera borrar,
// una meta incumplida desaparecería del historial. Sin versión vigente, avance, reparto y cierre la
// ignoran solos; las capturas siguen y el cierre las muestra con meta 0.
function retirarObjetivo(DB, datos, usuario) {
  const motivo = typeof datos.motivo === "string" ? datos.motivo.trim() : "";
  if (!motivo) throw new Error("Eliminar una meta requiere un motivo; no puede estar vacío");
  const vigente = objetivoVigente(DB, datos);
  if (!vigente) throw new Error("No hay meta vigente que eliminar");
  vigente.vigente = false;
  vigente.retirada = {
    por_id: usuario?.id ?? null,
    por_nombre: usuario?.nombre || "desconocido",
    en: new Date().toISOString(),
    motivo,
  };
  return vigente;
}
```

Agregar `retirarObjetivo` a `module.exports`.

- [ ] **Step 4: Correr y ver que pasan**

Run: `node --preserve-symlinks --preserve-symlinks-main --test objetivos.test.js`
Expected: PASS (todas, incluidas las previas).

- [ ] **Step 5: Commit** (lo hace Claude)

```bash
git add backend/objetivos.js backend/objetivos.test.js
git commit -m "feat(objetivos): retirar una meta con motivo sin borrarla"
```

---

### Task 2: la foto "al corte de ayer" respeta la retirada

**Files:**
- Modify: `backend/objetivosAvance.js` (función `fotoAl`, línea ~146: el `.map` de `objetivos`)
- Test: `backend/objetivosAvance.test.js` (al final)

**Interfaces:**
- Consumes: `retirarObjetivo` (Task 1).

- [ ] **Step 1: Prueba que falla.** Antes de escribirla, leer cómo `objetivosAvance.test.js` ya prueba el % de tienda de la vendedora con corte (buscar `fotoAl` o el nombre exportado que use el corte, p. ej. `avanceTiendaParaVendedora`) y copiar su preparación de DB. La prueba debe:
  1. fijar meta de tienda venta 1000 con `creado_en` de AYER (asignar a mano `DB.pos.objetivos[i].creado_en` a una fecha ISO de ayer después de `fijarObjetivo`) y una captura de 500 de ayer;
  2. retirarla hoy (`retirada.en` = ahora) → el % de tienda que ve la vendedora HOY sigue siendo 50 (ayer la meta existía);
  3. cambiar `retirada.en` a una fecha ISO de ayer → el % de tienda ya no tiene meta (0 o ausente, según lo que devuelve hoy la función cuando no hay meta; afirmar exactamente ese valor).

```js
test("la meta retirada hoy sigue contando en la foto de ayer y la retirada ayer ya no", () => {
  // preparación copiada de la prueba existente del % de tienda con corte (ver Step 1)
  // ... fijar meta tienda 1000 creada ayer, captura 500 ayer ...
  retirarObjetivo(DB, { tipo: "venta", mes: MES, sucursal_id: 1, vendedor_id: null, motivo: "x" }, { id: 1, nombre: "Victor" });
  assert.strictEqual(porcentajeTiendaVisto(DB), 50);
  DB.pos.objetivos.find((o) => o.retirada).retirada.en = AYER_ISO;
  assert.strictEqual(porcentajeTiendaVisto(DB), VALOR_SIN_META);
});
```

`porcentajeTiendaVisto`, `AYER_ISO`, `VALOR_SIN_META` y `MES` se definen en la prueba con la función exportada y el valor reales que use el archivo; si la función no se puede llamar con un "ahora" controlado, fijar las fechas relativas a `new Date()`.

- [ ] **Step 2: Correr y ver que falla**

Run: `node --preserve-symlinks --preserve-symlinks-main --test objetivosAvance.test.js`
Expected: FAIL en el paso 3 (la foto revive la meta retirada ayer porque recalcula `vigente` solo con reemplazos).

- [ ] **Step 3: Implementar** — en `fotoAl`, cambiar la línea de `objetivos`:

```js
      objetivos: objetivos.filter((o) => antes(o.creado_en)).map((o) => ({
        ...o,
        vigente: !reemplazadasAntes.has(o.id) && !(o.retirada && o.retirada.en < corte),
      })),
```

- [ ] **Step 4: Correr y ver que pasa** (mismo comando). Expected: PASS.

- [ ] **Step 5: Commit** (Claude): `fix(objetivos): la foto al corte respeta la meta retirada`

---

### Task 3: ruta `POST /api/objetivos/retirar`

**Files:**
- Modify: `backend/server.js` (nueva ruta justo después de `app.post("/api/objetivos", ...)`, línea ~2706; importar `retirarObjetivo` donde se importa `fijarObjetivo`)
- Test: `backend/objetivosRutas.test.js` (al final; reutilizar `admin`, `vendedor`, `gerente`, `servidor`, `base` y helpers de petición que ya define el archivo)

**Interfaces:**
- Consumes: `retirarObjetivo` (Task 1), `validarMesObjetivosAbierto`, `sucursalObjetivosPermitida`, `idDeObjetivos`.
- Produces: `POST /api/objetivos/retirar` body `{ tipo, mes, sucursal_id, vendedor_id|null, actividad?, marca_id?, producto_meta_id?, financiera?, motivo }` → 200 con el registro retirado.

- [ ] **Step 1: Pruebas que fallan** — casos (usar el helper de peticiones del archivo):
  - gerente con `editar_objetivos_venta` retira meta de venta de tienda con motivo → 200, `retirada.motivo` correcto, y `GET /api/objetivos/:mes/1` ya no trae meta de tienda.
  - sin motivo → 400 con mensaje que contiene "motivo".
  - vendedor sin `editar_objetivos_venta` → 403.
  - gerente con alcance de otra sucursal → 404.
  - mes cerrado (usar `cerrarMes` como ya lo hace el archivo) → 400 "ya está cerrado".
  - meta de marca con capturas: retirar → `GET /api/objetivos/:mes/1/previo-cierre` sigue mostrando la marca con `meta: 0` y su `capturado`.
  - retirar → `POST /api/objetivos` misma llave sin motivo → 200 (no hay vigente, no exige motivo) y versión siguiente.
  - agregar `["POST", "/api/objetivos/retirar", { ...META, motivo: "x" }]` al arreglo `RUTAS` del inicio para que hereden las pruebas de "sin login = 401".

- [ ] **Step 2: Correr y ver que fallan**

Run: `node --preserve-symlinks --preserve-symlinks-main --test objetivosRutas.test.js`
Expected: FAIL — 404 de Express en la ruta nueva.

- [ ] **Step 3: Implementar**

```js
app.post("/api/objetivos/retirar", requiereLogin, requierePermiso("editar_objetivos_venta", resolverPermisosDeRol), (req, res) => {
  try {
    const datos = { ...req.body, sucursal_id: idDeObjetivos(req.body?.sucursal_id, "sucursal_id"),
      vendedor_id: req.body?.vendedor_id === null ? null : idDeObjetivos(req.body?.vendedor_id, "vendedor_id") };
    if (!sucursalObjetivosPermitida(req, datos.sucursal_id)) return res.status(404).json({ error: "Objetivo no encontrado" });
    validarMesObjetivosAbierto(datos.mes, datos.sucursal_id);
    res.json(retirarObjetivo(DB, datos, req.usuarioToken));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
```

Verificar que `req.usuarioToken` trae `id` y `nombre` (ver cómo `fijarObjetivo` lo usa). Si el token no trae `id`, usar el campo de id que sí traiga y anotarlo en el reporte.

- [ ] **Step 4: Correr y ver que pasan** (mismo comando + `objetivos.test.js` + `objetivosAvance.test.js`). Expected: PASS.

- [ ] **Step 5: Commit** (Claude): `feat(objetivos): ruta para eliminar una meta con motivo`

---

### Task 4: botón "Eliminar meta" en las pantallas y retirada en el historial

**Files:**
- Modify: `src/objetivos/DialogosObjetivos.jsx` (`HistorialMetas` línea 59; componente nuevo `EliminarMeta`)
- Modify (integración): `src/GerenciaVentas.jsx` (venta, filas de tienda y persona junto al botón de historial, línea ~198), `src/objetivos/MarcasGerente.jsx` (marca/producto/crédito, junto a "Historial" líneas ~198 y ~243), `src/objetivos/ActividadesGerente.jsx` (líneas ~234 y ~295), `src/objetivos/InventariosGerente.jsx` (junto al historial, línea ~62)
- Test: el archivo de pruebas de pantalla de objetivos que ya exista en `src/` para estos componentes (buscar `src/**/*.test.js*` que importen `MarcasGerente` o `DialogosObjetivos`); si no hay, crear `src/objetivos/eliminarMeta.test.js` siguiendo el estilo de las pruebas de `src/` existentes.

**Interfaces:**
- Consumes: `POST /api/objetivos/retirar` (Task 3); `Modal` de `DialogosObjetivos.jsx`; `apiFetch` como lo usan las pantallas.
- Produces: `export function EliminarMeta({ llave, titulo, alTerminar, cerrar })` donde `llave` = cuerpo sin motivo para la ruta.

- [ ] **Step 1: Prueba que falla** (render del componente): sin motivo el botón "Eliminar" está deshabilitado; con motivo llama `apiFetch("/objetivos/retirar", { method: "POST", body: JSON.stringify({ ...llave, motivo }) })` y luego `alTerminar()`; si la API responde error, se muestra el mensaje y no se cierra. Y `HistorialMetas` con una versión `{ vigente:false, retirada:{ por_nombre:"Victor", motivo:"error", en } }` muestra "Eliminada por Victor" y "Motivo: error".

- [ ] **Step 2: Correr y ver que falla** — `node --preserve-symlinks --preserve-symlinks-main --test <archivo>` desde la raíz.

- [ ] **Step 3: Implementar**

En `DialogosObjetivos.jsx`:

```jsx
export function EliminarMeta({ llave, titulo, alTerminar, cerrar }) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const eliminar = async () => {
    setEnviando(true); setError("");
    try {
      await apiFetch("/objetivos/retirar", { method: "POST", body: JSON.stringify({ ...llave, motivo: motivo.trim() }) });
      alTerminar();
    } catch (e) { setError(e.message); } finally { setEnviando(false); }
  };
  return (
    <Modal titulo={`Eliminar meta: ${titulo}`} cerrar={cerrar} guardar={eliminar} textoGuardar="Eliminar"
      deshabilitado={enviando || !motivo.trim()} error={error} focoEnCerrar>
      <p className="text-sm text-slate-600 mb-2">La meta deja de contar en el avance y en el cierre. Queda en el
        historial con tu nombre y el motivo. Lo que ya se capturó no se borra.</p>
      <Campo etiqueta="Motivo" valor={motivo} cambiar={setMotivo} area />
    </Modal>
  );
}
```

(Importar `useState` y `apiFetch` con la misma ruta que usan los demás archivos de `src/objetivos/`; revisar que `Modal` ya pone `type="submit"` o botón explícito, y que tiene scroll.)

En `HistorialMetas`, dentro del `<li>`, después del motivo:

```jsx
                {h.retirada && (
                  <p className="text-red-700">
                    Eliminada por {h.retirada.por_nombre} · {new Date(h.retirada.en).toLocaleString("es-MX")} · Motivo: {h.retirada.motivo}
                  </p>
                )}
```

Integración en cada pantalla: junto a cada botón "Historial"/"Historial de tienda" de una fila CON meta vigente (monto definido), agregar `<button type="button" className="text-red-700 hover:underline" onClick={() => setEliminar({ llave, titulo })}>Eliminar</button>`; un estado `eliminar` por pantalla que renderiza `<EliminarMeta ... alTerminar={() => { setEliminar(null); recargar(); }} cerrar={() => setEliminar(null)} />`, donde `recargar` es la función que ya usa esa pantalla después de fijar una meta. `llave` = el mismo objeto (sin `monto` ni `motivo`) que esa pantalla manda hoy a `POST /objetivos` para esa fila. No mostrar el botón si el mes está cerrado (las pantallas ya reciben `cerrado`).

- [ ] **Step 4: Correr y ver que pasan** — la prueba nueva y todo `src/`: `node --preserve-symlinks --preserve-symlinks-main --test src`. Expected: PASS. Y `npm run build` sin errores (lo corre Claude si el sandbox no deja).

- [ ] **Step 5: Commit** (Claude): `feat(objetivos): boton para eliminar meta y retirada en el historial`

---

## Verificación final (Claude)

- Suite completa `backend` y `src` en verde; build de Vite.
- Navegador con copia local: fijar meta de venta de tienda y de una vendedora, capturar venta, eliminar la de la vendedora con motivo → desaparece del avance, el historial la muestra eliminada, el cierre previo la muestra con meta 0 y su capturado; volver a fijarla → versión siguiente; sellar el mes → ya no aparece "Eliminar".
