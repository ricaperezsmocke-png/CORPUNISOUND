# Dashboard de Personal en Roles y Personal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Personal" sub-tab to the "Roles y Personal" screen listing every registered staff member (name, login, role, sucursal, status), with the ability to edit name/role/password, activate/deactivate, and permanently delete each person.

**Architecture:** Backend: extend the existing `PUT /api/usuarios/:id` route to also support a password change and to block self-deactivation; add a new `DELETE /api/usuarios/:id` route that blocks self-deletion. Frontend: add a `sucursales` load to `AdminRoles.jsx`'s existing `cargarTodo`, a new `vistaRoles` sub-tab state ("roles" | "personal"), a read-only table for the "personal" sub-view, and an edit modal wired to the extended/new backend routes.

**Tech Stack:** React 18 (frontend, `src/AdminRoles.jsx`); Node.js + Express + in-memory `DB` (backend, `backend/usuarios.js` + `backend/server.js`); `node:test` + `assert` (backend tests, new file `backend/usuarios.test.js`).

## Global Constraints

- Reuse the existing `administrar_roles` permission for viewing/editing/deactivating/deleting personnel — do not create a new permission (matches the spec: this dashboard is an extension of the existing "Roles y Personal" screen, already gated by that permission).
- `dar_alta_personal` stays the permission for creating new personnel (unchanged, already correct).
- Nobody can deactivate or delete their own currently-logged-in account. This must be enforced in the backend (not just hidden in the frontend) — "el frontend oculta, el backend igual deniega" is a standing rule of this project.
- Deleting a `usuario` is a real, permanent deletion (not a soft-delete) — confirmed safe by the spec because `cortes_caja` and `compras` already store `usuario_nombre` as a frozen snapshot alongside `usuario_id`, and neither does a live lookup against the current `usuarios` list.
- Follow the existing code style in each file exactly (2-space indent, no semicolon style changes, no reformatting of untouched lines).
- No automated frontend test harness exists in this repo — frontend tasks are verified manually via Playwright + real Chrome against an isolated `DB_PATH`, never the real `backend/datos.sqlite`.

---

### Task 1: Backend — password change and self-deactivation guard on `PUT /api/usuarios/:id`

**Files:**
- Modify: `backend/usuarios.js` (function `actualizarUsuario`, add new exported helper `esAccionSobreSiMismo`)
- Modify: `backend/server.js:48` (import line), `backend/server.js:649-651` (the `PUT /api/usuarios/:id` route)
- Test: `backend/usuarios.test.js` (new file)

**Interfaces:**
- Produces: `actualizarUsuario(DB, id, datos)` becomes `async`, returns `Promise<usuarioSinPassword>` (same shape as before, `password_hash` stripped), now also updates `password_hash` when `datos.password` is a non-empty string of at least 6 characters, and throws `Error("La contraseña debe tener al menos 6 caracteres")` if a shorter one is given.
- Produces: `esAccionSobreSiMismo(idObjetivo, idSolicitante)` → `boolean`, exported from `backend/usuarios.js`. Used by Task 2 as well (both `PUT` and `DELETE` routes).

- [ ] **Step 1: Write the failing tests**

Create `backend/usuarios.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { actualizarUsuario, esAccionSobreSiMismo } = require("./usuarios");

function sembrarUsuarioDePrueba(DB, overrides = {}) {
  DB.admin.usuarios.push({
    id: 50, nombre: "Empleado Prueba", usuario: "empleado.prueba",
    password_hash: "$2b$10$hashViejoDePrueba", rol_id: 1, sucursal_id: 1, activo: true,
    ...overrides,
  });
}

test("actualizarUsuario: cambia la contraseña cuando se manda una nueva válida", async () => {
  const DB = construirDBPrueba();
  sembrarUsuarioDePrueba(DB);
  const hashAntes = DB.admin.usuarios.find((u) => u.id === 50).password_hash;

  await actualizarUsuario(DB, 50, { password: "nuevaClave123" });

  const hashDespues = DB.admin.usuarios.find((u) => u.id === 50).password_hash;
  assert.notStrictEqual(hashDespues, hashAntes, "el hash debe cambiar");
});

test("actualizarUsuario: NO cambia la contraseña cuando no se manda", async () => {
  const DB = construirDBPrueba();
  sembrarUsuarioDePrueba(DB);
  const hashAntes = DB.admin.usuarios.find((u) => u.id === 50).password_hash;

  await actualizarUsuario(DB, 50, { nombre: "Empleado Renombrado" });

  const usuario = DB.admin.usuarios.find((u) => u.id === 50);
  assert.strictEqual(usuario.password_hash, hashAntes, "el hash no debe tocarse");
  assert.strictEqual(usuario.nombre, "Empleado Renombrado", "el cambio de nombre sí debe aplicarse");
});

test("actualizarUsuario: NO cambia la contraseña cuando se manda vacía", async () => {
  const DB = construirDBPrueba();
  sembrarUsuarioDePrueba(DB);
  const hashAntes = DB.admin.usuarios.find((u) => u.id === 50).password_hash;

  await actualizarUsuario(DB, 50, { password: "" });

  assert.strictEqual(DB.admin.usuarios.find((u) => u.id === 50).password_hash, hashAntes);
});

test("actualizarUsuario: rechaza una contraseña nueva de menos de 6 caracteres", async () => {
  const DB = construirDBPrueba();
  sembrarUsuarioDePrueba(DB);

  await assert.rejects(
    () => actualizarUsuario(DB, 50, { password: "abc12" }),
    /al menos 6 caracteres/
  );
});

test("esAccionSobreSiMismo: true cuando el id objetivo es el mismo que el solicitante", () => {
  assert.strictEqual(esAccionSobreSiMismo(50, 50), true);
  assert.strictEqual(esAccionSobreSiMismo("50", 50), true, "debe comparar como número, no como string");
});

test("esAccionSobreSiMismo: false cuando son distintos", () => {
  assert.strictEqual(esAccionSobreSiMismo(50, 51), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test usuarios.test.js`
Expected: `esAccionSobreSiMismo` tests fail with "is not a function" (not exported yet); password tests fail because `actualizarUsuario` doesn't touch passwords yet.

- [ ] **Step 3: Implement `actualizarUsuario` password support and `esAccionSobreSiMismo`**

In `backend/usuarios.js`, replace the current `actualizarUsuario` function:

```js
function actualizarUsuario(DB, id, datos) {
  const idx = DB.admin.usuarios.findIndex((u) => u.id === Number(id));
  if (idx === -1) throw new Error("Usuario no encontrado");
  DB.admin.usuarios[idx] = {
    ...DB.admin.usuarios[idx],
    nombre: datos.nombre ?? DB.admin.usuarios[idx].nombre,
    rol_id: datos.rol_id !== undefined ? Number(datos.rol_id) : DB.admin.usuarios[idx].rol_id,
    activo: datos.activo !== undefined ? !!datos.activo : DB.admin.usuarios[idx].activo,
  };
  const { password_hash, ...sinPassword } = DB.admin.usuarios[idx];
  return sinPassword;
}
```

with this (adds password handling, becomes `async`):

```js
async function actualizarUsuario(DB, id, datos) {
  const idx = DB.admin.usuarios.findIndex((u) => u.id === Number(id));
  if (idx === -1) throw new Error("Usuario no encontrado");
  if (datos.password && datos.password.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres");

  DB.admin.usuarios[idx] = {
    ...DB.admin.usuarios[idx],
    nombre: datos.nombre ?? DB.admin.usuarios[idx].nombre,
    rol_id: datos.rol_id !== undefined ? Number(datos.rol_id) : DB.admin.usuarios[idx].rol_id,
    activo: datos.activo !== undefined ? !!datos.activo : DB.admin.usuarios[idx].activo,
  };
  if (datos.password) {
    DB.admin.usuarios[idx].password_hash = await hashearPassword(datos.password);
  }
  const { password_hash, ...sinPassword } = DB.admin.usuarios[idx];
  return sinPassword;
}

function esAccionSobreSiMismo(idObjetivo, idSolicitante) {
  return Number(idObjetivo) === Number(idSolicitante);
}
```

Update the `module.exports` line at the bottom of `backend/usuarios.js`:

```js
module.exports = { listarUsuarios, crearUsuario, actualizarUsuario, eliminarUsuario, esAccionSobreSiMismo, iniciarSesion };
```

(`eliminarUsuario` is added here already even though it's implemented in Task 2 — this avoids a second edit to the same export line. Task 2 will add the function itself.)

- [ ] **Step 4: Update the PUT route in `backend/server.js`**

Update the import at line 48, from:

```js
const { listarUsuarios, crearUsuario, actualizarUsuario, iniciarSesion } = require("./usuarios");
```

to:

```js
const { listarUsuarios, crearUsuario, actualizarUsuario, eliminarUsuario, esAccionSobreSiMismo, iniciarSesion } = require("./usuarios");
```

Replace the current route (currently lines 649-651):

```js
app.put("/api/usuarios/:id", requiereLogin, requierePermiso("administrar_roles", resolverPermisosDeRol), (req, res) => {
  try { res.json(actualizarUsuario(DB, req.params.id, req.body)); } catch (e) { res.status(400).json({ error: e.message }); }
});
```

with:

```js
app.put("/api/usuarios/:id", requiereLogin, requierePermiso("administrar_roles", resolverPermisosDeRol), async (req, res) => {
  try {
    if (req.body.activo === false && esAccionSobreSiMismo(req.params.id, req.usuarioToken.id)) {
      throw new Error("No puedes desactivarte a ti mismo mientras tienes la sesión abierta");
    }
    res.json(await actualizarUsuario(DB, req.params.id, req.body));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && node --test usuarios.test.js`
Expected: `# pass 6`, `# fail 0`.

- [ ] **Step 6: Run the full backend suite to confirm no regressions**

Run: `cd backend && node --test`
Expected: all tests pass (no new failures vs. before this task).

- [ ] **Step 7: Commit**

```bash
git add backend/usuarios.js backend/server.js backend/usuarios.test.js
git commit -m "feat: support password change and block self-deactivation in PUT /api/usuarios/:id"
```

---

### Task 2: Backend — `DELETE /api/usuarios/:id` with self-deletion guard

**Files:**
- Modify: `backend/usuarios.js` (add `eliminarUsuario`)
- Modify: `backend/server.js` (add the new route, right after the existing `PUT /api/usuarios/:id` route)
- Modify: `backend/usuarios.test.js` (add tests)
- Test (regression, cross-module): also add a test using `backend/cortes.js`'s `crearCorte` to confirm deletion doesn't affect a corte's stored `usuario_nombre`.

**Interfaces:**
- Consumes: `esAccionSobreSiMismo` from Task 1 (already exported from `backend/usuarios.js`).
- Produces: `eliminarUsuario(DB, id)` → `{ ok: true }`, throws `Error("Usuario no encontrado")` if `id` doesn't exist. Removes the matching entry from `DB.admin.usuarios` (splice, not a soft-delete flag).

- [ ] **Step 1: Write the failing tests**

Append to `backend/usuarios.test.js` (add this import line at the top alongside the existing ones):

```js
const { crearCorte } = require("./cortes");
```

And add these tests at the end of the file:

```js
test("eliminarUsuario: remueve al usuario correctamente", () => {
  const DB = construirDBPrueba();
  sembrarUsuarioDePrueba(DB);

  const { eliminarUsuario } = require("./usuarios");
  const resultado = eliminarUsuario(DB, 50);

  assert.deepStrictEqual(resultado, { ok: true });
  assert.strictEqual(DB.admin.usuarios.find((u) => u.id === 50), undefined, "el usuario ya no debe existir en la lista");
});

test("eliminarUsuario: lanza error si el id no existe", () => {
  const DB = construirDBPrueba();
  const { eliminarUsuario } = require("./usuarios");

  assert.throws(() => eliminarUsuario(DB, 999), /Usuario no encontrado/);
});

test("eliminarUsuario: no afecta el usuario_nombre ya guardado en un corte de caja existente", () => {
  const DB = construirDBPrueba();
  sembrarUsuarioDePrueba(DB, { nombre: "Cajero Que Se Va" });

  const corte = crearCorte(DB, {
    sucursal_id: 1,
    usuario_id: 50,
    usuario_nombre: "Cajero Que Se Va",
    contado: { efectivo: 100 },
    retiro: {},
  });

  const { eliminarUsuario } = require("./usuarios");
  eliminarUsuario(DB, 50);

  const corteGuardado = DB.pos.cortes_caja.find((c) => c.id === corte.id);
  assert.strictEqual(corteGuardado.usuario_nombre, "Cajero Que Se Va", "el nombre congelado en el corte no debe cambiar ni desaparecer al borrar el usuario");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test usuarios.test.js`
Expected: fails with "eliminarUsuario is not a function" (not implemented yet). If the `crearCorte` test fails for a different reason (e.g. a required field), check `backend/cortes.test.js` for the exact `crearCorte` call shape used elsewhere in this repo and match it — the contract is `crearCorte(DB, { sucursal_id, usuario_id, usuario_nombre, contado, retiro })` per `backend/cortes.js:73`.

- [ ] **Step 3: Implement `eliminarUsuario`**

In `backend/usuarios.js`, add this function (place it after `actualizarUsuario`, before `iniciarSesion`):

```js
function eliminarUsuario(DB, id) {
  const idx = DB.admin.usuarios.findIndex((u) => u.id === Number(id));
  if (idx === -1) throw new Error("Usuario no encontrado");
  DB.admin.usuarios.splice(idx, 1);
  return { ok: true };
}
```

(The `module.exports` line already includes `eliminarUsuario` from Task 1's Step 3 — no further export change needed.)

- [ ] **Step 4: Add the DELETE route in `backend/server.js`**

Immediately after the `PUT /api/usuarios/:id` route (added/modified in Task 1), add:

```js
app.delete("/api/usuarios/:id", requiereLogin, requierePermiso("administrar_roles", resolverPermisosDeRol), (req, res) => {
  try {
    if (esAccionSobreSiMismo(req.params.id, req.usuarioToken.id)) {
      throw new Error("No puedes eliminarte a ti mismo mientras tienes la sesión abierta");
    }
    res.json(eliminarUsuario(DB, req.params.id));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && node --test usuarios.test.js`
Expected: `# pass 9`, `# fail 0`.

- [ ] **Step 6: Run the full backend suite to confirm no regressions**

Run: `cd backend && node --test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/usuarios.js backend/server.js backend/usuarios.test.js
git commit -m "feat: add DELETE /api/usuarios/:id with a self-deletion guard"
```

---

### Task 3: Frontend — "Personal" sub-tab with a read-only list

**Files:**
- Modify: `src/AdminRoles.jsx`

**Interfaces:**
- Consumes: `GET /api/sucursales` (existing route, already used elsewhere in this file inside the separate `UbicacionesTiendas` component — this task adds an equivalent fetch at the TOP-LEVEL `AdminRoles` component, since `UbicacionesTiendas`'s local `sucursales` state is not accessible outside that component).
- Produces: top-level `sucursales` state (array of `{id, nombre, ...}`), a `vistaRoles` state (`"roles" | "personal"`), consumed by Task 4 for the edit modal.

- [ ] **Step 1: Add `sucursales` loading and the `vistaRoles` sub-tab state**

In `src/AdminRoles.jsx`, find the state declarations inside `AdminRoles` (currently around lines 174-183):

```js
  const [roles, setRoles] = useState([]);
  const [rolActivoId, setRolActivoId] = useState(null);
  const [catalogo, setCatalogo] = useState({ permisos: [], modulos: [] });
  const [usuarios, setUsuarios] = useState([]);
  const [busquedaPermiso, setBusquedaPermiso] = useState("");
```

Add `sucursales` and `vistaRoles` right after `usuarios`:

```js
  const [roles, setRoles] = useState([]);
  const [rolActivoId, setRolActivoId] = useState(null);
  const [catalogo, setCatalogo] = useState({ permisos: [], modulos: [] });
  const [usuarios, setUsuarios] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [vistaRoles, setVistaRoles] = useState("roles"); // "roles" | "personal"
  const [busquedaPermiso, setBusquedaPermiso] = useState("");
```

Find `cargarTodo` (currently lines 187-207):

```js
  const cargarTodo = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [rRoles, rCatalogo, rUsuarios] = await Promise.all([
        apiFetch("/roles"),
        apiFetch("/permisos-catalogo"),
        apiFetch("/usuarios"),
      ]);
      if (!rRoles.ok) throw new Error("No se pudieron cargar los roles");
      const roles = await rRoles.json();
      setRoles(roles);
      setRolActivoId((prev) => prev ?? roles[0]?.id ?? null);
      if (rCatalogo.ok) setCatalogo(await rCatalogo.json());
      if (rUsuarios.ok) setUsuarios(await rUsuarios.json());
    } catch (e) {
      setError("No se pudo conectar con el backend, o tu usuario no tiene permiso para administrar roles.");
    } finally {
      setCargando(false);
    }
  }, []);
```

Replace it with (adds `/sucursales` to the parallel fetch, and sets it):

```js
  const cargarTodo = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [rRoles, rCatalogo, rUsuarios, rSucursales] = await Promise.all([
        apiFetch("/roles"),
        apiFetch("/permisos-catalogo"),
        apiFetch("/usuarios"),
        apiFetch("/sucursales"),
      ]);
      if (!rRoles.ok) throw new Error("No se pudieron cargar los roles");
      const roles = await rRoles.json();
      setRoles(roles);
      setRolActivoId((prev) => prev ?? roles[0]?.id ?? null);
      if (rCatalogo.ok) setCatalogo(await rCatalogo.json());
      if (rUsuarios.ok) setUsuarios(await rUsuarios.json());
      if (rSucursales.ok) setSucursales(await rSucursales.json());
    } catch (e) {
      setError("No se pudo conectar con el backend, o tu usuario no tiene permiso para administrar roles.");
    } finally {
      setCargando(false);
    }
  }, []);
```

Add two helper functions right after `nombreModulo` (currently line 228, `const nombreModulo = (id) => catalogo.modulos.find((m) => m.id === id)?.nombre || id;`):

```js
  const nombreRol = (id) => roles.find((r) => r.id === id)?.nombre || "Rol desconocido";
  const nombreSucursalPersonal = (id) => sucursales.find((s) => s.id === id)?.nombre || `Sucursal ${id}`;
```

- [ ] **Step 2: Add the "Roles" / "Personal" sub-tab bar and the list table**

This step replaces the ENTIRE `{vistaAdmin === "roles" && ( ... )}` block. Find it — currently lines 343-449 of `src/AdminRoles.jsx`, starting with:

```jsx
      {vistaAdmin === "roles" && (
        <>
          <div className="bg-white border-b border-slate-100 flex overflow-x-auto shrink-0">
```

and ending with:

```jsx
          )}
        </>
      )}

      {vistaAdmin === "ubicaciones" && puede("administrar_roles") && <UbicacionesTiendas mostrarAviso={mostrarAviso} />}
```

Replace the complete block (all of lines 343-449) with this. It keeps the toolbar and error banner exactly as they were, adds the new "Roles"/"Personal" sub-tab bar, and wraps the ORIGINAL role-selector `<div>` plus the original `{cargando ? ... : ...}` ternary inside a new `{vistaRoles === "personal" ? (<personal table>) : (<>...original two pieces, now inside a Fragment...</>)}` conditional — the modules/permissions grid content inside that ternary's last branch is completely unchanged from the original file, only re-indented one level deeper because it's now nested one level further in:

```jsx
      {vistaAdmin === "roles" && (
        <>
          <div className="bg-white border-b border-slate-100 flex overflow-x-auto shrink-0">
            {puede("administrar_roles") && <BotonBarra icono={Plus} etiqueta="Agregar" atajo="F3" tono="verde" onClick={agregarRol} />}
            {puede("administrar_roles") && <BotonBarra icono={Edit3} etiqueta="Editar" atajo="F4" onClick={editarNombreRol} />}
            <BotonBarra icono={RefreshCw} etiqueta="Recargar" atajo="F5" onClick={cargarTodo} />
            {puede("administrar_roles") && <BotonBarra icono={Trash2} etiqueta="Eliminar" atajo="F6" tono="rojo" onClick={eliminarRolActivo} />}
            <BotonBarra icono={Share2} etiqueta="Compartir" atajo="F7" onClick={() => mostrarAviso("Compartir configuración — próximamente")} />
            <BotonBarra icono={Download} etiqueta="Descargar" atajo="F8" onClick={() => mostrarAviso("Exportar configuración — próximamente")} />
            {puede("administrar_roles") && <BotonBarra icono={Copy} etiqueta="Clonar" atajo="F9" onClick={clonarRolActivo} />}
            <div className="ml-auto flex items-center pr-3">
              {puede("dar_alta_personal") && (
                <button onClick={() => setModalPersonal(true)} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3 py-1.5 rounded">
                  <UserPlus size={14} /> Dar de alta personal
                </button>
              )}
            </div>
          </div>

          {error && <div className="bg-red-50 border-b border-red-200 text-red-700 text-xs px-4 py-2">{error}</div>}

          <div className="bg-white border-b border-slate-100 flex items-center gap-1 px-4 shrink-0">
            <button
              onClick={() => setVistaRoles("roles")}
              className={`px-3 py-2 text-xs font-medium border-b-2 ${vistaRoles === "roles" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}
            >
              Roles
            </button>
            <button
              onClick={() => setVistaRoles("personal")}
              className={`px-3 py-2 text-xs font-medium border-b-2 ${vistaRoles === "personal" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}
            >
              Personal ({usuarios.length})
            </button>
          </div>

          {vistaRoles === "personal" ? (
            <div className="flex-1 overflow-y-auto p-4">
              <table className="w-full text-sm bg-white border border-slate-200 rounded-lg overflow-hidden">
                <thead className="bg-[#1a7fe8] text-white">
                  <tr>
                    <th className="py-2 px-3 text-left font-medium">Nombre</th>
                    <th className="py-2 px-3 text-left font-medium">Usuario</th>
                    <th className="py-2 px-3 text-left font-medium">Rol</th>
                    <th className="py-2 px-3 text-left font-medium">Sucursal</th>
                    <th className="py-2 px-3 text-center font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {usuarios.length === 0 && (
                    <tr><td colSpan={5} className="text-center text-slate-400 py-10">Sin personal registrado</td></tr>
                  )}
                  {usuarios.map((u) => (
                    <tr key={u.id} className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer">
                      <td className="py-2 px-3">{u.nombre}</td>
                      <td className="py-2 px-3 text-slate-500">{u.usuario}</td>
                      <td className="py-2 px-3">{nombreRol(u.rol_id)}</td>
                      <td className="py-2 px-3 text-slate-500">{nombreSucursalPersonal(u.sucursal_id)}</td>
                      <td className="py-2 px-3 text-center">
                        {u.activo ? (
                          <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">Activo</span>
                        ) : (
                          <span className="text-[11px] font-medium text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">Inactivo</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              <div className="bg-white border-b border-slate-200 px-4 py-2.5 flex items-center gap-2 shrink-0">
                <ShieldCheck size={16} className="text-blue-700" />
                <span className="text-slate-500">Rol:</span>
                <select
                  value={rolActivoId || ""}
                  onChange={(e) => setRolActivoId(Number(e.target.value))}
                  className="border border-slate-300 rounded px-3 py-1.5 font-medium text-blue-700 min-w-[200px]"
                >
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                </select>
                {rolActivo && (
                  <span className="text-xs text-slate-400 ml-2">
                    {usuarios.filter((u) => u.rol_id === rolActivo.id).length} persona(s) con este rol
                  </span>
                )}
              </div>

              {cargando ? (
                <p className="text-center text-slate-400 py-16">Cargando...</p>
              ) : !rolActivo ? (
                <p className="text-center text-slate-400 py-16">No hay roles todavía — usa "Agregar" para crear el primero</p>
              ) : (
                <div className="flex-1 overflow-y-auto">
                  <div className="bg-white border-b border-slate-200 px-4 py-4">
                    <div className="text-xs font-semibold text-slate-500 mb-3">Módulos habilitados para este rol</div>
                    <div className="flex flex-wrap gap-3">
                      {catalogo.modulos.map((m) => {
                        const activo = rolActivo.modulos.includes(m.id);
                        return (
                          <button
                            key={m.id}
                            onClick={() => alternarModulo(m.id)}
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                              activo ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-400 hover:border-slate-300"
                            }`}
                          >
                            <span className={`w-2 h-2 rounded-full ${activo ? "bg-emerald-500" : "bg-slate-300"}`} />
                            {m.nombre}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="p-4">
                    <div className="flex items-center gap-2 mb-4">
                      <Search size={16} className="text-slate-400" />
                      <input
                        value={busquedaPermiso}
                        onChange={(e) => setBusquedaPermiso(e.target.value)}
                        placeholder="Buscar permiso..."
                        className="border border-slate-300 rounded px-3 py-1.5 text-sm flex-1 max-w-sm focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    {Object.entries(permisosPorModulo).map(([moduloId, permisos]) => (
                      <div key={moduloId} className="mb-5">
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{nombreModulo(moduloId)}</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                          {permisos.map((p) => {
                            const activo = rolActivo.permisos.includes(p.clave);
                            return (
                              <label
                                key={p.clave}
                                className={`flex items-start gap-2 border rounded-lg px-3 py-2.5 cursor-pointer text-sm ${
                                  activo ? "border-emerald-300 bg-emerald-50" : "border-slate-200 hover:border-slate-300"
                                }`}
                              >
                                <input type="checkbox" checked={activo} onChange={() => alternarPermiso(p.clave)} className="mt-0.5" />
                                <span className={activo ? "text-emerald-800" : "text-slate-600"}>
                                  {p.etiqueta}
                                  {!p.implementado && (
                                    <span className="block text-[10px] text-amber-600 mt-0.5">Módulo aún no construido — el permiso queda guardado para cuando exista</span>
                                  )}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {vistaAdmin === "ubicaciones" && puede("administrar_roles") && <UbicacionesTiendas mostrarAviso={mostrarAviso} />}
```

Everything inside the `) : ( <> ... </> )` branch (the role selector `<div>`, the `{cargando ? ... }` ternary, and everything inside it down to the permissions grid) is byte-for-byte the same JSX that was already in the file — it's just now wrapped in a `<>...</>` Fragment and nested one level deeper inside the new `vistaRoles` ternary, so it renders exactly as it did before whenever `vistaRoles === "roles"` (the default state).

- [ ] **Step 3: Manual verification (no automated frontend test harness in this repo)**

Run against an isolated temp `DB_PATH` (never the real `backend/datos.sqlite`):

```bash
cd backend && DB_PATH=<temp-file> PORT=<free-port> node server.js
# separate terminal, from repo root:
VITE_API_URL=http://localhost:<free-port>/api npm run dev -- --port <free-port-2>
```

Using Playwright + real Chrome (`channel: 'chrome'`) or manually:
1. Log in as Administrador, go to Roles y Personal.
2. Confirm the new "Roles" / "Personal" sub-tab bar appears below the F3-F9 toolbar.
3. Click "Personal" — confirm a table appears listing every seeded/created user with correct Nombre/Usuario/Rol/Sucursal/Estado columns, and the count in the tab label ("Personal (N)") matches.
4. Click "Roles" — confirm the original role/permission editor still works exactly as before (this task must not break it).
5. Create a new user via "Dar de alta personal", switch to "Personal", confirm it appears in the list without needing a manual page reload (since `guardarPersonal` already calls `cargarTodo()`).

Stop both servers and delete the temp DB file when done.

- [ ] **Step 4: Commit**

```bash
git add src/AdminRoles.jsx
git commit -m "feat: add read-only Personal list sub-tab to Roles y Personal"
```

---

### Task 4: Frontend — edit modal (nombre/rol/contraseña, activar/desactivar, eliminar)

**Files:**
- Modify: `src/AdminRoles.jsx`
- Modify: `src/App.jsx` (pass the `usuario` prop to `<AdminRoles>`, matching the existing pattern used for `<Traspasos>`)

**Interfaces:**
- Consumes: `PUT /api/usuarios/:id` and `DELETE /api/usuarios/:id` (both from Tasks 1-2), `usuarios`/`sucursales`/`nombreRol`/`nombreSucursalPersonal`/`cargarTodo`/`mostrarAviso` (all from Task 3 or earlier in this file).
- Produces: nothing consumed by later tasks (this is the last task).

- [ ] **Step 1: Add state for the edit modal**

Find the existing modal-related state (currently around lines 182-183):

```js
  const [modalPersonal, setModalPersonal] = useState(false);
  const [formPersonal, setFormPersonal] = useState({ nombre: "", usuario: "", password: "", rol_id: "" });
```

Add right after:

```js
  const [modalPersonal, setModalPersonal] = useState(false);
  const [formPersonal, setFormPersonal] = useState({ nombre: "", usuario: "", password: "", rol_id: "" });
  const [personaEditando, setPersonaEditando] = useState(null); // usuario seleccionado o null
  const [formEditarPersonal, setFormEditarPersonal] = useState({ nombre: "", rol_id: "", password: "" });
```

You'll also need to know the CURRENTLY logged-in user's id to hide the self-action buttons. Confirmed: `AdminRoles` is rendered in `src/App.jsx:83` as `<AdminRoles onVolver={() => setVista("dashboard")} permisos={usuario.permisos} />` — no `usuario` prop is passed today, even though the `usuario` variable is already in scope at that call site (it's passed to sibling screens the same way, e.g. `src/App.jsx:80`: `<Traspasos onVolver={() => setVista("dashboard")} permisos={usuario.permisos} usuario={usuario} />`).

In `src/App.jsx`, find (line 83):

```jsx
          <AdminRoles onVolver={() => setVista("dashboard")} permisos={usuario.permisos} />
```

Replace it with:

```jsx
          <AdminRoles onVolver={() => setVista("dashboard")} permisos={usuario.permisos} usuario={usuario} />
```

In `src/AdminRoles.jsx`, find the component signature (currently line 171):

```js
export default function AdminRoles({ onVolver, permisos }) {
```

Replace it with:

```js
export default function AdminRoles({ onVolver, permisos, usuario }) {
```

- [ ] **Step 2: Add the modal-opening and action functions**

Add these functions right after `guardarPersonal` (currently ends around line 314):

```js
  const abrirEditarPersonal = (u) => {
    setPersonaEditando(u);
    setFormEditarPersonal({ nombre: u.nombre, rol_id: u.rol_id, password: "" });
  };

  const guardarEdicionPersonal = async () => {
    if (!formEditarPersonal.nombre.trim()) return mostrarAviso("El nombre no puede quedar vacío");
    if (!formEditarPersonal.rol_id) return mostrarAviso("Selecciona un rol");
    try {
      const payload = { nombre: formEditarPersonal.nombre, rol_id: formEditarPersonal.rol_id };
      if (formEditarPersonal.password) payload.password = formEditarPersonal.password;
      const r = await apiFetch(`/usuarios/${personaEditando.id}`, { method: "PUT", body: JSON.stringify(payload) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Personal actualizado");
      setPersonaEditando(null);
      await cargarTodo();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const alternarActivoPersonal = async () => {
    try {
      const r = await apiFetch(`/usuarios/${personaEditando.id}`, { method: "PUT", body: JSON.stringify({ activo: !personaEditando.activo }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso(personaEditando.activo ? "Personal desactivado" : "Personal activado");
      setPersonaEditando(null);
      await cargarTodo();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const eliminarPersonal = async () => {
    if (!confirm(`¿Eliminar a "${personaEditando.nombre}" del sistema? Esta acción no se puede deshacer.`)) return;
    try {
      const r = await apiFetch(`/usuarios/${personaEditando.id}`, { method: "DELETE" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Personal eliminado");
      setPersonaEditando(null);
      await cargarTodo();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };
```

- [ ] **Step 3: Wire each row to open the modal**

In the Personal table body added in Task 3, find this row (inside the `{usuarios.map((u) => (` block):

```jsx
                    <tr key={u.id} className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer">
```

Replace it with:

```jsx
                    <tr key={u.id} onClick={() => abrirEditarPersonal(u)} className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer">
```

- [ ] **Step 4: Add the edit modal JSX**

Find the closing of the existing `modalPersonal` modal block (currently the last JSX block before the final closing `</div>\n  );\n}` of the component, ending with):

```jsx
              <button onClick={guardarPersonal} className="bg-[#1a7fe8] hover:bg-[#1262b8] text-white py-2 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-colors">
                <Check size={15} /> Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

Replace it with (adds the new modal right after, keeps the same closing structure):

```jsx
              <button onClick={guardarPersonal} className="bg-[#1a7fe8] hover:bg-[#1262b8] text-white py-2 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-colors">
                <Check size={15} /> Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {personaEditando && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
              <h3 className="font-semibold text-sm text-slate-700">Editar personal</h3>
              <button onClick={() => setPersonaEditando(null)} className="hover:bg-slate-100 rounded-lg p-1.5 text-slate-400 transition-colors"><X size={16} /></button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Nombre completo</label>
                <input className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm" value={formEditarPersonal.nombre} onChange={(e) => setFormEditarPersonal({ ...formEditarPersonal, nombre: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Rol</label>
                <select className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm" value={formEditarPersonal.rol_id} onChange={(e) => setFormEditarPersonal({ ...formEditarPersonal, rol_id: e.target.value })}>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Nueva contraseña (opcional — déjalo en blanco para no cambiarla)</label>
                <input type="password" className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm" value={formEditarPersonal.password} onChange={(e) => setFormEditarPersonal({ ...formEditarPersonal, password: e.target.value })} placeholder="Mínimo 6 caracteres" />
              </div>
              <button onClick={guardarEdicionPersonal} className="bg-[#1a7fe8] hover:bg-[#1262b8] text-white py-2 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-colors">
                <Check size={15} /> Guardar cambios
              </button>
              {usuario?.id !== personaEditando.id && (
                <div className="flex gap-2">
                  <button onClick={alternarActivoPersonal} className="flex-1 border border-slate-300 hover:bg-slate-50 text-slate-700 py-2 rounded-lg font-semibold text-sm transition-colors">
                    {personaEditando.activo ? "Desactivar" : "Activar"}
                  </button>
                  <button onClick={eliminarPersonal} className="flex-1 border border-red-300 hover:bg-red-50 text-red-600 py-2 rounded-lg font-semibold text-sm transition-colors">
                    Eliminar
                  </button>
                </div>
              )}
              {usuario?.id === personaEditando.id && (
                <p className="text-[11px] text-slate-400 text-center">No puedes desactivarte o eliminarte a ti mismo mientras tienes la sesión abierta.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Manual verification (no automated frontend test harness in this repo)**

Run against an isolated temp `DB_PATH`, same setup pattern as Task 3 Step 3, on different ports.

Using Playwright + real Chrome or manually:
1. Log in as Administrador, go to Roles y Personal → Personal.
2. Create a second test user via "Dar de alta personal" (so you have someone other than yourself to test destructive actions on).
3. Click that second user's row — confirm the edit modal opens with their current nombre/rol pre-filled and password blank.
4. Change only the nombre, save — confirm the list updates and shows the new name.
5. Reopen, change the rol, save — confirm the list shows the new rol.
6. Reopen, type a new password (6+ chars), save — log out, confirm the OLD password no longer works and the NEW one does for that test user.
7. Reopen, click "Desactivar" — confirm the badge in the list flips to "Inactivo", and confirm that test user can no longer log in (`iniciarSesion` requires `activo`).
8. Reopen, click "Activar" — confirm it flips back and the user can log in again.
9. Reopen, click "Eliminar", confirm the browser's native confirm dialog appears, accept it — confirm the row disappears from the list entirely.
10. Click on YOUR OWN row (the Administrador account you're logged in as) — confirm the "Desactivar"/"Eliminar" buttons are NOT shown, and instead the explanatory text appears.
11. As an extra safety check, try calling the backend directly to confirm the guard isn't just a frontend hide: with your own auth token, attempt `PUT /api/usuarios/<tu-propio-id>` with `{"activo": false}` and `DELETE /api/usuarios/<tu-propio-id>` — both must return a 400 error, not succeed.

Stop both servers and delete the temp DB file when done.

- [ ] **Step 6: Commit**

```bash
git add src/AdminRoles.jsx
git commit -m "feat: add edit/activate/deactivate/delete modal to the Personal list"
```

---

## Self-Review Notes

- Spec coverage: all sections of `docs/superpowers/specs/2026-07-17-dashboard-personal-design.md` are covered — sub-tab structure (Task 3), edit modal with nombre/rol/password (Task 4), activar/desactivar (Task 4), eliminar (Task 4), backend password support (Task 1), backend self-protection on both routes (Tasks 1 and 2), backend DELETE route (Task 2), regression test confirming `usuario_nombre` survives deletion (Task 2).
- No placeholders: every step has exact file paths, exact current code to find, and exact replacement code.
- Type consistency: `esAccionSobreSiMismo(idObjetivo, idSolicitante)` signature is defined once in Task 1 and consumed identically (positional args, same order) in both the `PUT` route (Task 1) and the `DELETE` route (Task 2). `formEditarPersonal` shape (`{ nombre, rol_id, password }`) is defined in Task 4 Step 1 and used consistently in Steps 2 and 4 of the same task.
- Task 4's dependency on `AdminRoles` receiving a `usuario` prop was confirmed against the actual current code (`src/App.jsx:83`, `src/Traspasos.jsx`'s existing signature) during plan-writing — Step 1 gives the exact before/after code for both files, not a conditional check.
