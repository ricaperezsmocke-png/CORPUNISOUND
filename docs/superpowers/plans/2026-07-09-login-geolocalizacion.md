# Login con selección de sucursal + validación por ubicación (GPS) — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Al iniciar sesión, un usuario amarrado a una sucursal selecciona cuál es y el navegador valida su ubicación GPS contra la coordenada configurada de esa tienda — si no coincide (o no la seleccionó bien), el login se bloquea y queda registrado. Administrador entra exento, como hoy. Una pantalla nueva permite capturar la ubicación de cada tienda y revisar los intentos bloqueados.

**Architecture:** La validación vive en un helper puro (`validarUbicacionLogin`) en `backend/auth.js`, que la ruta `POST /api/auth/login` invoca después de verificar usuario/contraseña. Las coordenadas de cada tienda se guardan directamente en `DB.pos.sucursales` (campos `lat`/`lng`, `null` = sin configurar). Los intentos bloqueados se acumulan en una colección nueva, visible solo para quien tenga el permiso `administrar_roles` (reutilizado, sin permiso nuevo).

**Tech Stack:** Node.js + Express (backend, datos en memoria), React + Vite (frontend), `navigator.geolocation` (API nativa del navegador, sin librerías nuevas), pruebas con el runner integrado de Node (`node --test`).

## Global Constraints

- **Radio de tolerancia: 300 metros** — constante fija en `auth.js`, no configurable desde la UI en este alcance.
- **Sin lockout de cuenta:** solo se registra el intento bloqueado; no hay límite de reintentos.
- **Administrador (permiso `ver_todas_las_sucursales`) siempre exento** — entra sin selector obligatorio ni validación de GPS, igual que hoy.
- **Sucursal sin coordenadas configuradas (`lat`/`lng` en `null`) → login procede sin validar GPS** — así ninguna tienda queda bloqueada mientras Victor captura las 4 ubicaciones.
- **Sin permisos nuevos:** las pantallas de configuración de ubicaciones y de intentos bloqueados usan el permiso `administrar_roles` ya existente.
- **MercadoLibre (sucursal virtual, `ciudad: "Online"`) no participa** — no se le puede asignar ubicación.
- **Sin dependencias nuevas.**
- **Idioma:** todo el código, comentarios y mensajes en español, siguiendo el estilo de los archivos existentes.

---

### Task 1: `distanciaMetros` + `validarUbicacionLogin` en `backend/auth.js`

**Files:**
- Modify: `backend/auth.js` (nuevo import, nuevos helpers, `module.exports`)
- Create: `backend/ubicacionLogin.test.js`

**Interfaces:**
- Consumes: `permisosDeRol(DB, rolId)` (de `./roles`, ya existe).
- Produces:
  - `distanciaMetros(lat1, lng1, lat2, lng2)` → número, metros entre dos coordenadas (fórmula de Haversine).
  - `validarUbicacionLogin(usuario, sucursalSeleccionadaId, lat, lng, DB)` → `{ ok: true }` o `{ ok: false, motivo: "sucursal_no_coincide" | "ubicacion_no_coincide" | "sin_permiso_ubicacion", distancia?: number }`. `usuario` es el objeto `{ rol_id, sucursal_id, ... }` ya autenticado (password ya verificado por el llamador).
  - `mensajePorMotivoUbicacion(motivo)` → string en español, listo para mostrar al usuario, sin revelar la sucursal real de la cuenta.

- [ ] **Step 1: Escribir las pruebas (fallan primero)**

Crear `backend/ubicacionLogin.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { distanciaMetros, validarUbicacionLogin } = require("./auth");

test("distanciaMetros entre el mismo punto es 0", () => {
  assert.strictEqual(distanciaMetros(17.9, -92.9, 17.9, -92.9), 0);
});

test("distanciaMetros aproxima 1 grado de longitud en el ecuador a ~111.32 km", () => {
  const d = distanciaMetros(0, 0, 0, 1);
  assert.ok(Math.abs(d - 111320) < 500, `esperado ~111320m, obtuve ${d}`);
});

test("validarUbicacionLogin: usuario global (ver_todas_las_sucursales) siempre ok, sin pedir sucursal ni ubicación", () => {
  const DB = construirDBPrueba();
  const admin = { rol_id: 1, sucursal_id: 1 }; // rol 1 = Administrador (sembrado por construirDBPrueba)
  const r = validarUbicacionLogin(admin, undefined, undefined, undefined, DB);
  assert.deepStrictEqual(r, { ok: true });
});

test("validarUbicacionLogin: usuario amarrado con sucursal seleccionada distinta a la real -> sucursal_no_coincide", () => {
  const DB = construirDBPrueba();
  const cajero = { rol_id: 3, sucursal_id: 2 }; // rol 3 = Cajero
  const r = validarUbicacionLogin(cajero, 1, 17.9, -92.9, DB);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, "sucursal_no_coincide");
});

test("validarUbicacionLogin: sucursal correcta pero sin coordenadas configuradas -> ok (no bloquea)", () => {
  const DB = construirDBPrueba();
  const cajero = { rol_id: 3, sucursal_id: 2 };
  const r = validarUbicacionLogin(cajero, 2, null, null, DB);
  assert.deepStrictEqual(r, { ok: true });
});

test("validarUbicacionLogin: sin lat/lng cuando la sucursal SÍ tiene coordenadas -> sin_permiso_ubicacion", () => {
  const DB = construirDBPrueba();
  const sucursal = DB.pos.sucursales.find((s) => s.id === 2);
  sucursal.lat = 17.9583; sucursal.lng = -92.9128;
  const cajero = { rol_id: 3, sucursal_id: 2 };
  const r = validarUbicacionLogin(cajero, 2, null, null, DB);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, "sin_permiso_ubicacion");
});

test("validarUbicacionLogin: fuera del radio de tolerancia -> ubicacion_no_coincide", () => {
  const DB = construirDBPrueba();
  const sucursal = DB.pos.sucursales.find((s) => s.id === 2);
  sucursal.lat = 17.9583; sucursal.lng = -92.9128;
  const cajero = { rol_id: 3, sucursal_id: 2 };
  // ~1km al norte del punto configurado — muy fuera de los 300m de tolerancia
  const r = validarUbicacionLogin(cajero, 2, 17.9673, -92.9128, DB);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, "ubicacion_no_coincide");
  assert.ok(r.distancia > 300);
});

test("validarUbicacionLogin: dentro del radio de tolerancia -> ok", () => {
  const DB = construirDBPrueba();
  const sucursal = DB.pos.sucursales.find((s) => s.id === 2);
  sucursal.lat = 17.9583; sucursal.lng = -92.9128;
  const cajero = { rol_id: 3, sucursal_id: 2 };
  const r = validarUbicacionLogin(cajero, 2, 17.9583, -92.9128, DB); // mismo punto exacto
  assert.deepStrictEqual(r, { ok: true });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && node --test ubicacionLogin.test.js`
Expected: FAIL — `distanciaMetros is not a function` (no existe todavía).

- [ ] **Step 3: Implementar en `backend/auth.js`**

Al inicio del archivo, después del `const jwt = require("jsonwebtoken");` (línea 15), agregar:

```js
const { permisosDeRol } = require("./roles");
```

Antes de `module.exports` (al final del archivo), agregar:

```js
const RADIO_TOLERANCIA_METROS = 300;

/** Distancia en metros entre dos coordenadas (fórmula de Haversine). */
function distanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000; // radio de la Tierra en metros
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Valida que quien inicia sesión esté físicamente en la sucursal que dice
 * ser. Usuario con "ver_todas_las_sucursales" (Administrador) siempre pasa
 * sin evaluar nada más. Usuario amarrado: la sucursal seleccionada debe
 * coincidir con la de su cuenta; si esa sucursal tiene coordenadas
 * configuradas, además su ubicación GPS debe caer dentro del radio de
 * tolerancia. Sin coordenadas configuradas en la sucursal, no se valida GPS
 * todavía (para no bloquear una tienda antes de que Victor la configure).
 */
function validarUbicacionLogin(usuario, sucursalSeleccionadaId, lat, lng, DB) {
  const permisos = permisosDeRol(DB, usuario.rol_id);
  if (permisos.includes("ver_todas_las_sucursales")) return { ok: true };

  const sucursalReal = usuario.sucursal_id != null ? Number(usuario.sucursal_id) : null;
  if (sucursalReal == null || Number(sucursalSeleccionadaId) !== sucursalReal) {
    return { ok: false, motivo: "sucursal_no_coincide" };
  }

  const sucursal = DB.pos.sucursales.find((s) => s.id === sucursalReal);
  if (!sucursal || sucursal.lat == null || sucursal.lng == null) {
    return { ok: true };
  }

  if (lat == null || lng == null) {
    return { ok: false, motivo: "sin_permiso_ubicacion" };
  }

  const distancia = distanciaMetros(Number(lat), Number(lng), sucursal.lat, sucursal.lng);
  if (distancia > RADIO_TOLERANCIA_METROS) {
    return { ok: false, motivo: "ubicacion_no_coincide", distancia };
  }
  return { ok: true };
}

/** Traduce el motivo de bloqueo a un mensaje claro, sin revelar la sucursal real de la cuenta. */
function mensajePorMotivoUbicacion(motivo) {
  if (motivo === "sucursal_no_coincide") return "La sucursal seleccionada no coincide con tu cuenta.";
  if (motivo === "ubicacion_no_coincide") return "Tu ubicación no coincide con la sucursal seleccionada. Verifica que tengas el GPS activado y que estés en la tienda.";
  if (motivo === "sin_permiso_ubicacion") return "Debes permitir el acceso a tu ubicación para iniciar sesión.";
  return "No se pudo iniciar sesión.";
}
```

Y actualizar `module.exports`:

```js
module.exports = {
  hashearPassword, verificarPassword, firmarToken, verificarToken, requiereLogin, requierePermiso,
  alcanceSucursal, filtrarPorSucursal, dentroDeAlcance,
  distanciaMetros, validarUbicacionLogin, mensajePorMotivoUbicacion,
};
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd backend && node --test ubicacionLogin.test.js`
Expected: PASS — 8 tests passing.

Run: `cd backend && npm test`
Expected: PASS — todas las suites existentes siguen en verde (agregar `require("./roles")` a `auth.js` no crea ciclo: `roles.js` solo importa `./permisosCatalogo`).

- [ ] **Step 5: Commit**

```bash
git add backend/auth.js backend/ubicacionLogin.test.js
git commit -m "feat: helper validarUbicacionLogin — valida sucursal y GPS al iniciar sesión"
```

---

### Task 2: `POST /api/auth/login` valida ubicación y registra intentos bloqueados

**Files:**
- Modify: `backend/server.js` (import, seed, ruta de login)

**Interfaces:**
- Consumes: `validarUbicacionLogin`, `mensajePorMotivoUbicacion` (Task 1).
- Produces: `POST /api/auth/login` acepta además `sucursal_id_seleccionada`, `lat`, `lng` en el body; bloquea con `401` y motivo cuando la validación falla; registra el intento en `DB.admin.intentos_bloqueados_ubicacion`.

- [ ] **Step 1: Importar los helpers nuevos**

En `backend/server.js:37`, reemplazar:

```js
const { requiereLogin, requierePermiso, firmarToken, alcanceSucursal, dentroDeAlcance } = require("./auth");
```

por:

```js
const { requiereLogin, requierePermiso, firmarToken, alcanceSucursal, dentroDeAlcance, validarUbicacionLogin, mensajePorMotivoUbicacion } = require("./auth");
```

- [ ] **Step 2: Agregar `lat`/`lng` a las 4 sucursales físicas y la colección de intentos bloqueados al seed**

En `backend/server.js:97-103`, reemplazar el arreglo `sucursales`:

```js
    sucursales: [
      { id: 1, nombre: "Ocosingo", ciudad: "Chiapas", lat: null, lng: null },
      { id: 2, nombre: "Yajalón", ciudad: "Chiapas", lat: null, lng: null },
      { id: 3, nombre: "San Cristóbal", ciudad: "Chiapas", lat: null, lng: null },
      { id: 4, nombre: "Palenque", ciudad: "Chiapas", lat: null, lng: null },
      { id: 5, nombre: "MercadoLibre", ciudad: "Online" },
    ],
```

En `backend/server.js:173-176`, reemplazar el bloque `admin`:

```js
  admin: {
    roles: [],
    usuarios: [],
    intentos_bloqueados_ubicacion: []
  },
```

- [ ] **Step 3: Reemplazar la ruta de login**

Reemplazar la ruta completa (`backend/server.js:427-434`):

```js
app.post("/api/auth/login", async (req, res) => {
  try {
    const { usuario, password, sucursal_id_seleccionada, lat, lng } = req.body;
    const encontrado = await iniciarSesion(DB, usuario, password);
    const resultado = validarUbicacionLogin(encontrado, sucursal_id_seleccionada, lat, lng, DB);
    if (!resultado.ok) {
      const sucursalDijo = DB.pos.sucursales.find((s) => s.id === Number(sucursal_id_seleccionada));
      const nuevoId = DB.admin.intentos_bloqueados_ubicacion.length
        ? Math.max(...DB.admin.intentos_bloqueados_ubicacion.map((i) => i.id)) + 1
        : 1;
      DB.admin.intentos_bloqueados_ubicacion.push({
        id: nuevoId,
        usuario: encontrado.usuario,
        sucursal_dijo_id: sucursal_id_seleccionada != null && sucursal_id_seleccionada !== "" ? Number(sucursal_id_seleccionada) : null,
        sucursal_dijo_nombre: sucursalDijo ? sucursalDijo.nombre : "—",
        sucursal_real_id: encontrado.sucursal_id,
        lat_detectada: lat != null ? Number(lat) : null,
        lng_detectada: lng != null ? Number(lng) : null,
        distancia_metros: resultado.distancia != null ? Math.round(resultado.distancia) : null,
        motivo: resultado.motivo,
        fecha: new Date().toISOString(),
      });
      return res.status(401).json({ error: mensajePorMotivoUbicacion(resultado.motivo), motivo: resultado.motivo });
    }
    const token = firmarToken(encontrado);
    res.json({ token, usuario: armarSesion(DB, encontrado) });
  } catch (e) { res.status(401).json({ error: e.message }); }
});
```

- [ ] **Step 4: Correr toda la suite de backend**

Run: `cd backend && npm test`
Expected: PASS — todas las suites en verde.

- [ ] **Step 5: Verificación manual end-to-end**

Levantar el backend en una base de datos temporal:

```bash
cd backend
DB_PATH=/tmp/verify_ubicacion.sqlite PORT=4324 JWT_SECRET=verify-secret node server.js
```

En otra terminal:

```bash
BASE=http://localhost:4324
curl -s -X POST $BASE/api/auth/setup-inicial -H "Content-Type: application/json" -d '{"nombre":"Admin","usuario":"admin","password":"Admin1234"}'
TOKEN_ADMIN=$(curl -s -X POST $BASE/api/auth/login -H "Content-Type: application/json" -d '{"usuario":"admin","password":"Admin1234"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token))")

# Admin exento: entra sin sucursal_id_seleccionada ni lat/lng
curl -s -X POST $BASE/api/auth/login -H "Content-Type: application/json" -d '{"usuario":"admin","password":"Admin1234"}'

# Crear un rol Cajero mínimo y un cajero amarrado a sucursal 2 (Yajalón)
curl -s $BASE/api/roles -H "Authorization: Bearer $TOKEN_ADMIN"   # anota el id del rol "Cajero"
curl -s -X POST $BASE/api/usuarios -H "Authorization: Bearer $TOKEN_ADMIN" -H "Content-Type: application/json" -d '{"nombre":"Cajero Yajalon","usuario":"cajero_test","password":"Cajero1234","rol_id":3,"sucursal_id":2}'

# Cajero sin seleccionar sucursal -> bloqueado (sucursal_no_coincide)
curl -s -X POST $BASE/api/auth/login -H "Content-Type: application/json" -d '{"usuario":"cajero_test","password":"Cajero1234"}'

# Cajero con la sucursal correcta (2), sin coordenadas configuradas todavía -> pasa
curl -s -X POST $BASE/api/auth/login -H "Content-Type: application/json" -d '{"usuario":"cajero_test","password":"Cajero1234","sucursal_id_seleccionada":2}'
```

Expected:
- Admin entra en ambos casos sin problema (token + usuario).
- Cajero sin sucursal seleccionada → `401 {"error":"La sucursal seleccionada no coincide con tu cuenta.","motivo":"sucursal_no_coincide"}`.
- Cajero con sucursal correcta y sin coordenadas configuradas en esa sucursal → login exitoso (regla 5: sin GPS que validar todavía).

Detener el servidor y borrar `/tmp/verify_ubicacion.sqlite` al terminar. (La prueba de bloqueo POR ubicación real se completa en el Task 3, una vez exista la ruta para configurar coordenadas.)

- [ ] **Step 6: Commit**

```bash
git add backend/server.js
git commit -m "feat: POST /api/auth/login valida ubicación GPS y registra intentos bloqueados"
```

---

### Task 3: Rutas de configuración — ubicación de sucursales e intentos bloqueados

**Files:**
- Modify: `backend/server.js`

**Interfaces:**
- Consumes: nada nuevo (usa `DB.pos.sucursales`/`DB.admin.intentos_bloqueados_ubicacion` del Task 2).
- Produces: `PUT /api/sucursales/:id/ubicacion`, `GET /api/intentos-bloqueados` — ambas `requiereLogin` + `requierePermiso("administrar_roles", ...)`.

- [ ] **Step 1: Agregar las rutas**

Justo después de `app.get("/api/sucursales", (req, res) => res.json(DB.pos.sucursales));` (`backend/server.js:509`), agregar:

```js

app.put("/api/sucursales/:id/ubicacion", requiereLogin, requierePermiso("administrar_roles", resolverPermisosDeRol), (req, res) => {
  try {
    const sucursal = DB.pos.sucursales.find((s) => s.id === Number(req.params.id));
    if (!sucursal) throw new Error("Sucursal no encontrada");
    if (sucursal.ciudad === "Online") throw new Error("La sucursal virtual de MercadoLibre no usa ubicación");
    const { lat, lng } = req.body;
    sucursal.lat = lat !== undefined && lat !== null && lat !== "" ? Number(lat) : null;
    sucursal.lng = lng !== undefined && lng !== null && lng !== "" ? Number(lng) : null;
    res.json(sucursal);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/intentos-bloqueados", requiereLogin, requierePermiso("administrar_roles", resolverPermisosDeRol), (req, res) => {
  const lista = [...DB.admin.intentos_bloqueados_ubicacion].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  res.json(lista);
});
```

- [ ] **Step 2: Correr toda la suite de backend**

Run: `cd backend && npm test`
Expected: PASS — todas las suites en verde (esta tarea no agrega pruebas automatizadas; se valida manualmente, igual que Tasks 2-3 de planes anteriores para rutas de wiring).

- [ ] **Step 3: Verificación manual end-to-end (completa el ciclo del Task 2)**

Levantar el backend igual que en el Task 2:

```bash
cd backend
DB_PATH=/tmp/verify_ubicacion2.sqlite PORT=4325 JWT_SECRET=verify-secret node server.js
```

```bash
BASE=http://localhost:4325
curl -s -X POST $BASE/api/auth/setup-inicial -H "Content-Type: application/json" -d '{"nombre":"Admin","usuario":"admin","password":"Admin1234"}'
TOKEN_ADMIN=$(curl -s -X POST $BASE/api/auth/login -H "Content-Type: application/json" -d '{"usuario":"admin","password":"Admin1234"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token))")
curl -s -X POST $BASE/api/usuarios -H "Authorization: Bearer $TOKEN_ADMIN" -H "Content-Type: application/json" -d '{"nombre":"Cajero Yajalon","usuario":"cajero_test","password":"Cajero1234","rol_id":3,"sucursal_id":2}'

# Configurar la ubicación de la sucursal 2 (Yajalón)
curl -s -X PUT $BASE/api/sucursales/2/ubicacion -H "Authorization: Bearer $TOKEN_ADMIN" -H "Content-Type: application/json" -d '{"lat":17.9583,"lng":-92.9128}'

# Rechazar configurar MercadoLibre (sucursal 5)
curl -s -X PUT $BASE/api/sucursales/5/ubicacion -H "Authorization: Bearer $TOKEN_ADMIN" -H "Content-Type: application/json" -d '{"lat":17.9583,"lng":-92.9128}'

# Cajero con sucursal correcta y ubicación DENTRO del radio -> pasa
curl -s -X POST $BASE/api/auth/login -H "Content-Type: application/json" -d '{"usuario":"cajero_test","password":"Cajero1234","sucursal_id_seleccionada":2,"lat":17.9583,"lng":-92.9128}'

# Cajero con sucursal correcta pero ubicación FUERA del radio -> bloqueado
curl -s -X POST $BASE/api/auth/login -H "Content-Type: application/json" -d '{"usuario":"cajero_test","password":"Cajero1234","sucursal_id_seleccionada":2,"lat":17.9673,"lng":-92.9128}'

# Revisar el intento bloqueado registrado
curl -s $BASE/api/intentos-bloqueados -H "Authorization: Bearer $TOKEN_ADMIN"
```

Expected:
- `PUT /api/sucursales/2/ubicacion` devuelve la sucursal con `lat`/`lng` actualizados.
- `PUT /api/sucursales/5/ubicacion` → `400 {"error":"La sucursal virtual de MercadoLibre no usa ubicación"}`.
- Login dentro del radio → éxito (token).
- Login fuera del radio → `401 {"error":"Tu ubicación no coincide...","motivo":"ubicacion_no_coincide"}`.
- `GET /api/intentos-bloqueados` → incluye el intento con `motivo: "ubicacion_no_coincide"` y `distancia_metros` > 300.

Detener el servidor y borrar `/tmp/verify_ubicacion2.sqlite` al terminar.

- [ ] **Step 4: Commit**

```bash
git add backend/server.js
git commit -m "feat: rutas para configurar ubicación de sucursales y revisar intentos bloqueados"
```

---

### Task 4: Frontend — Login con selector de sucursal + captura de GPS

**Files:**
- Modify: `src/Login.jsx` (reemplazo completo del archivo)

**Interfaces:**
- Consumes: `GET /api/sucursales` (ya existe, público), `POST /api/auth/login` con `sucursal_id_seleccionada`/`lat`/`lng` (Task 2).

- [ ] **Step 1: Reemplazar todo el archivo**

```jsx
import React, { useState, useEffect } from "react";
import { Lock, User, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

function obtenerUbicacion() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ lat: null, lng: null });
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve({ lat: null, lng: null }),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

export default function Login({ onIngreso }) {
  const [necesitaSetup, setNecesitaSetup] = useState(null);
  const [sucursales, setSucursales] = useState([]);
  const [sucursalSeleccionada, setSucursalSeleccionada] = useState("");
  const [nombre, setNombre] = useState("");
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    fetch(`${API}/auth/necesita-setup`)
      .then((r) => r.json())
      .then((d) => setNecesitaSetup(d.necesitaSetup))
      .catch(() => setError("No se pudo conectar con el backend"));
    fetch(`${API}/sucursales`)
      .then((r) => r.json())
      .then((d) => setSucursales(d.filter((s) => s.ciudad !== "Online")))
      .catch(() => {});
  }, []);

  const enviarSetup = async (e) => {
    e.preventDefault();
    setError(null); setCargando(true);
    try {
      const r = await fetch(`${API}/auth/setup-inicial`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, usuario, password })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setNecesitaSetup(false);
    } catch (err) { setError(err.message); }
    finally { setCargando(false); }
  };

  const enviarLogin = async (e) => {
    e.preventDefault();
    setError(null); setCargando(true);
    try {
      const { lat, lng } = await obtenerUbicacion();
      const r = await fetch(`${API}/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, password, sucursal_id_seleccionada: sucursalSeleccionada || null, lat, lng })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      localStorage.setItem("token", data.token);
      localStorage.setItem("usuario", JSON.stringify(data.usuario));
      onIngreso(data.usuario, data.token);
    } catch (err) { setError(err.message); }
    finally { setCargando(false); }
  };

  return (
    <div
      className="w-full h-screen flex items-center justify-center"
      style={{ background: "linear-gradient(135deg, #1a7fe8 0%, #0f4c8a 100%)" }}
    >
      <Card className="w-full max-w-sm shadow-2xl border-0">
        <CardHeader className="items-center pb-2 pt-8">
          <img src="/logo-unisound.jpg" alt="Unisound" className="w-48 object-contain mb-2" />
          <p className="text-sm text-muted-foreground font-medium">Sistema de Gestión Empresarial</p>
        </CardHeader>

        <CardContent className="px-8 pb-2">
          {necesitaSetup === null && (
            <p className="text-center text-muted-foreground text-sm py-4">Conectando con el servidor...</p>
          )}

          {necesitaSetup === true && (
            <form onSubmit={enviarSetup} className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground bg-muted rounded-lg p-3 text-center">
                No hay personal registrado — crea la primera cuenta de Administrador.
              </p>
              <Input required value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Tu nombre" />
              <Input required value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="Usuario" />
              <Input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña (mínimo 6 caracteres)" />
              {error && <p className="text-destructive text-xs text-center">{error}</p>}
              <Button type="submit" disabled={cargando} className="w-full mt-1" style={{ backgroundColor: "#1a7fe8" }}>
                {cargando ? "Creando..." : "Crear administrador"}
              </Button>
            </form>
          )}

          {necesitaSetup === false && (
            <form onSubmit={enviarLogin} className="flex flex-col gap-3">
              <div className="relative">
                <User size={16} className="absolute left-3 top-2.5 text-muted-foreground" />
                <Input required value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="Usuario" className="pl-9" />
              </div>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-2.5 text-muted-foreground" />
                <Input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña" className="pl-9" />
              </div>
              <div className="relative">
                <MapPin size={16} className="absolute left-3 top-2.5 text-muted-foreground z-10" />
                <select
                  value={sucursalSeleccionada}
                  onChange={(e) => setSucursalSeleccionada(e.target.value)}
                  className="w-full h-10 pl-9 pr-3 rounded-md border border-input bg-background text-sm"
                >
                  <option value="">Selecciona tu sucursal (si aplica)</option>
                  {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </div>
              {error && <p className="text-destructive text-xs text-center">{error}</p>}
              <Button type="submit" disabled={cargando} className="w-full mt-1" style={{ backgroundColor: "#1a7fe8" }}>
                {cargando ? "Entrando..." : "Iniciar sesión"}
              </Button>
            </form>
          )}
        </CardContent>

        <CardFooter className="justify-center pb-6 pt-2">
          <p className="text-xs text-muted-foreground">Instrumentos Musicales / Sonido / Accesorios</p>
        </CardFooter>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Verificación manual**

Run: `npm run build` desde la raíz del repo.
Expected: build limpio, sin errores relacionados a `Login.jsx`.

Revisión de cableado (sin navegador disponible en este entorno):
- Confirmar que el selector de sucursal solo aparece en el formulario de login (`necesitaSetup === false`), no en el de alta inicial (`necesitaSetup === true`) — el Administrador que hace el primer setup nunca necesita seleccionar sucursal ni GPS.
- Confirmar que `enviarLogin` llama `obtenerUbicacion()` ANTES de mandar el POST, y que manda `lat`/`lng` como `null` (no falla, no bloquea el envío) si `obtenerUbicacion` resuelve sin ubicación.
- Confirmar que `sucursal_id_seleccionada` se manda como `null` (no `""`) cuando no hay selección — importante porque el backend hace `Number(sucursal_id_seleccionada)` y `Number(null)` es `0`, distinto de `Number("")` que es también `0`; ambos casos deben fallar como "sucursal_no_coincide" para cualquier usuario amarrado, lo cual es el comportamiento correcto (sin seleccionar, no puede coincidir con ninguna sucursal real ≥ 1).

- [ ] **Step 3: Commit**

```bash
git add src/Login.jsx
git commit -m "feat: login pide sucursal y ubicación GPS para usuarios amarrados"
```

---

### Task 5: Frontend — pantallas de Ubicaciones de Tiendas e Intentos Bloqueados

**Files:**
- Modify: `src/AdminRoles.jsx` (reemplazo completo del archivo)

**Interfaces:**
- Consumes: `GET /api/sucursales` (ya existe), `PUT /api/sucursales/:id/ubicacion`, `GET /api/intentos-bloqueados` (Task 3).

- [ ] **Step 1: Reemplazar todo el archivo**

El archivo gana: imports de `MapPin`/`ShieldAlert`, un estado `vistaAdmin` para alternar entre "Roles y Personal" (todo el contenido que ya existía, intacto) y las dos pantallas nuevas, y dos componentes locales nuevos (`UbicacionesTiendas`, `IntentosBloqueados`). Nada de la lógica de roles/permisos/personal existente cambia — solo queda envuelta en una pestaña.

```jsx
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus, Edit3, RefreshCw, Trash2, Copy, Share2, Download,
  Search, ShieldCheck, UserPlus, X, Check, MapPin, ShieldAlert
} from "lucide-react";
import { apiFetch } from "./api";

function BotonBarra({ icono: Icono, etiqueta, atajo, onClick, tono = "slate" }) {
  const tonos = { slate: "text-[#1a7fe8]", verde: "text-emerald-600", rojo: "text-red-500" };
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-1 px-3 py-2 min-w-[74px] border-r border-slate-100 hover:bg-blue-50 transition-colors"
    >
      <Icono size={18} className={tonos[tono]} />
      <span className="text-[10px] font-medium text-slate-500 whitespace-nowrap">{etiqueta}</span>
    </button>
  );
}

const MOTIVO_TEXTO = {
  sucursal_no_coincide: "Sucursal seleccionada no coincide",
  ubicacion_no_coincide: "Ubicación no coincide",
  sin_permiso_ubicacion: "Sin permiso de ubicación",
};

function UbicacionesTiendas({ mostrarAviso }) {
  const [sucursales, setSucursales] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [editando, setEditando] = useState({}); // { [id]: { lat, lng } }

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await apiFetch("/sucursales");
      const data = await r.json();
      setSucursales(data.filter((s) => s.ciudad !== "Online"));
    } catch { /* silencioso */ }
    finally { setCargando(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const valoresDe = (s) => editando[s.id] || { lat: s.lat ?? "", lng: s.lng ?? "" };

  const actualizarCampo = (id, campo, valor) => {
    setEditando((prev) => ({ ...prev, [id]: { ...valoresDe({ id }), ...prev[id], [campo]: valor } }));
  };

  const usarMiUbicacion = (id) => {
    if (!navigator.geolocation) return mostrarAviso("❌ Tu navegador no soporta geolocalización");
    navigator.geolocation.getCurrentPosition(
      (pos) => setEditando((prev) => ({ ...prev, [id]: { lat: pos.coords.latitude, lng: pos.coords.longitude } })),
      () => mostrarAviso("❌ No se pudo obtener tu ubicación"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const guardar = async (id) => {
    const valores = editando[id];
    if (!valores) return mostrarAviso("No hay cambios que guardar para esta tienda");
    try {
      const r = await apiFetch(`/sucursales/${id}/ubicacion`, { method: "PUT", body: JSON.stringify(valores) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Ubicación guardada");
      await cargar();
      setEditando((prev) => { const copia = { ...prev }; delete copia[id]; return copia; });
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  if (cargando) return <p className="text-center text-slate-400 py-16">Cargando...</p>;

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <p className="text-xs text-slate-500 mb-4 max-w-xl">
        Captura la ubicación de cada tienda para activar la validación por GPS en el login.
        Mientras una tienda no tenga ubicación configurada, el login de su personal no valida GPS.
      </p>
      <div className="flex flex-col gap-3 max-w-xl">
        {sucursales.map((s) => {
          const valores = valoresDe(s);
          return (
            <div key={s.id} className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="font-semibold mb-2">{s.nombre}</div>
              <div className="grid grid-cols-2 gap-3 mb-2">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Latitud</label>
                  <input
                    type="number" step="any" className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm"
                    value={valores.lat} onChange={(e) => actualizarCampo(s.id, "lat", e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Longitud</label>
                  <input
                    type="number" step="any" className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm"
                    value={valores.lng} onChange={(e) => actualizarCampo(s.id, "lng", e.target.value)}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => usarMiUbicacion(s.id)} className="text-xs border border-slate-300 rounded px-3 py-1.5 hover:bg-slate-50">
                  Usar mi ubicación actual
                </button>
                <button onClick={() => guardar(s.id)} className="text-xs bg-blue-700 hover:bg-blue-800 text-white rounded px-3 py-1.5 font-semibold">
                  Guardar
                </button>
              </div>
              {s.lat != null && s.lng != null ? (
                <p className="text-[11px] text-emerald-600 mt-2">Configurada: {s.lat}, {s.lng}</p>
              ) : (
                <p className="text-[11px] text-amber-600 mt-2">Sin configurar — el login de esta tienda no valida ubicación todavía</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IntentosBloqueados() {
  const [intentos, setIntentos] = useState([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    (async () => {
      setCargando(true);
      try {
        const r = await apiFetch("/intentos-bloqueados");
        if (r.ok) setIntentos(await r.json());
      } catch { /* silencioso */ }
      finally { setCargando(false); }
    })();
  }, []);

  if (cargando) return <p className="text-center text-slate-400 py-16">Cargando...</p>;

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <table className="w-full text-sm bg-white border border-slate-200 rounded-lg overflow-hidden">
        <thead className="bg-[#1a7fe8] text-white">
          <tr>
            <th className="py-2 px-3 text-left font-medium">Usuario</th>
            <th className="py-2 px-3 text-left font-medium">Dijo ser</th>
            <th className="py-2 px-3 text-left font-medium">Motivo</th>
            <th className="py-2 px-3 text-center font-medium">Distancia</th>
            <th className="py-2 px-3 text-left font-medium">Fecha</th>
          </tr>
        </thead>
        <tbody>
          {intentos.length === 0 && (
            <tr><td colSpan={5} className="text-center text-slate-400 py-10">Sin intentos bloqueados registrados</td></tr>
          )}
          {intentos.map((i) => (
            <tr key={i.id} className="border-b border-slate-100">
              <td className="py-2 px-3">{i.usuario}</td>
              <td className="py-2 px-3">{i.sucursal_dijo_nombre}</td>
              <td className="py-2 px-3">{MOTIVO_TEXTO[i.motivo] || i.motivo}</td>
              <td className="py-2 px-3 text-center text-slate-500">{i.distancia_metros != null ? `${Math.round(i.distancia_metros)} m` : "—"}</td>
              <td className="py-2 px-3 text-slate-500">{new Date(i.fecha).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminRoles({ onVolver, permisos }) {
  const puede = (clave) => !permisos || permisos.includes(clave);
  const [vistaAdmin, setVistaAdmin] = useState("roles"); // "roles" | "ubicaciones" | "bloqueados"
  const [roles, setRoles] = useState([]);
  const [rolActivoId, setRolActivoId] = useState(null);
  const [catalogo, setCatalogo] = useState({ permisos: [], modulos: [] });
  const [usuarios, setUsuarios] = useState([]);
  const [busquedaPermiso, setBusquedaPermiso] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [modalPersonal, setModalPersonal] = useState(false);
  const [formPersonal, setFormPersonal] = useState({ nombre: "", usuario: "", password: "", rol_id: "" });

  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 2200); };

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

  useEffect(() => { cargarTodo(); }, [cargarTodo]);

  const rolActivo = roles.find((r) => r.id === rolActivoId) || null;

  const permisosFiltrados = useMemo(() => {
    const t = busquedaPermiso.trim().toLowerCase();
    if (!t) return catalogo.permisos;
    return catalogo.permisos.filter((p) => p.etiqueta.toLowerCase().includes(t));
  }, [catalogo.permisos, busquedaPermiso]);

  const permisosPorModulo = useMemo(() => {
    const grupos = {};
    permisosFiltrados.forEach((p) => {
      grupos[p.modulo] = grupos[p.modulo] || [];
      grupos[p.modulo].push(p);
    });
    return grupos;
  }, [permisosFiltrados]);

  const nombreModulo = (id) => catalogo.modulos.find((m) => m.id === id)?.nombre || id;

  const guardarCambiosRol = async (rolId, cambios) => {
    setRoles((prev) => prev.map((r) => (r.id === rolId ? { ...r, ...cambios } : r)));
    try {
      const r = await apiFetch(`/roles/${rolId}`, { method: "PUT", body: JSON.stringify(cambios) });
      if (!r.ok) throw new Error((await r.json()).error);
    } catch (e) {
      mostrarAviso("❌ " + e.message);
      cargarTodo();
    }
  };

  const alternarPermiso = (clave) => {
    if (!puede("administrar_roles")) return mostrarAviso("No tienes permiso para modificar roles");
    if (!rolActivo) return;
    const tiene = rolActivo.permisos.includes(clave);
    const nuevos = tiene ? rolActivo.permisos.filter((p) => p !== clave) : [...rolActivo.permisos, clave];
    guardarCambiosRol(rolActivo.id, { permisos: nuevos });
  };

  const alternarModulo = (moduloId) => {
    if (!puede("administrar_roles")) return mostrarAviso("No tienes permiso para modificar roles");
    if (!rolActivo) return;
    const tiene = rolActivo.modulos.includes(moduloId);
    const nuevos = tiene ? rolActivo.modulos.filter((m) => m !== moduloId) : [...rolActivo.modulos, moduloId];
    guardarCambiosRol(rolActivo.id, { modulos: nuevos });
  };

  const agregarRol = async () => {
    const nombre = prompt("Nombre del nuevo rol:");
    if (!nombre) return;
    try {
      const r = await apiFetch("/roles", { method: "POST", body: JSON.stringify({ nombre, permisos: [], modulos: [] }) });
      const nuevo = await r.json();
      if (!r.ok) throw new Error(nuevo.error);
      await cargarTodo();
      setRolActivoId(nuevo.id);
      mostrarAviso("Rol creado");
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const editarNombreRol = async () => {
    if (!rolActivo) return mostrarAviso("Selecciona un rol primero");
    const nombre = prompt("Nuevo nombre del rol:", rolActivo.nombre);
    if (!nombre) return;
    guardarCambiosRol(rolActivo.id, { nombre });
  };

  const eliminarRolActivo = async () => {
    if (!rolActivo) return mostrarAviso("Selecciona un rol primero");
    if (!confirm(`¿Eliminar el rol "${rolActivo.nombre}"? Esto falla si hay personal asignado a él.`)) return;
    try {
      const r = await apiFetch(`/roles/${rolActivo.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json()).error);
      setRolActivoId(null);
      await cargarTodo();
      mostrarAviso("Rol eliminado");
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const clonarRolActivo = async () => {
    if (!rolActivo) return mostrarAviso("Selecciona un rol primero");
    try {
      const r = await apiFetch(`/roles/${rolActivo.id}/clonar`, { method: "POST", body: JSON.stringify({}) });
      const nuevo = await r.json();
      if (!r.ok) throw new Error(nuevo.error);
      await cargarTodo();
      setRolActivoId(nuevo.id);
      mostrarAviso("Rol clonado");
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const guardarPersonal = async () => {
    if (!formPersonal.nombre || !formPersonal.usuario || !formPersonal.password || !formPersonal.rol_id) {
      return mostrarAviso("Completa nombre, usuario, contraseña y rol");
    }
    try {
      const r = await apiFetch("/usuarios", { method: "POST", body: JSON.stringify(formPersonal) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Personal agregado");
      setModalPersonal(false);
      setFormPersonal({ nombre: "", usuario: "", password: "", rol_id: "" });
      cargarTodo();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 font-sans text-sm">
      <div className="bg-white border-b border-slate-100 flex items-center overflow-x-auto shrink-0">
        <button
          onClick={() => setVistaAdmin("roles")}
          className={`px-4 py-3 text-sm font-medium border-b-2 ${vistaAdmin === "roles" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}
        >
          <ShieldCheck size={14} className="inline mr-1.5 -mt-0.5" /> Roles y Personal
        </button>
        {puede("administrar_roles") && (
          <button
            onClick={() => setVistaAdmin("ubicaciones")}
            className={`px-4 py-3 text-sm font-medium border-b-2 ${vistaAdmin === "ubicaciones" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}
          >
            <MapPin size={14} className="inline mr-1.5 -mt-0.5" /> Ubicaciones de Tiendas
          </button>
        )}
        {puede("administrar_roles") && (
          <button
            onClick={() => setVistaAdmin("bloqueados")}
            className={`px-4 py-3 text-sm font-medium border-b-2 ${vistaAdmin === "bloqueados" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}
          >
            <ShieldAlert size={14} className="inline mr-1.5 -mt-0.5" /> Intentos Bloqueados
          </button>
        )}
      </div>

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

      {vistaAdmin === "ubicaciones" && puede("administrar_roles") && <UbicacionesTiendas mostrarAviso={mostrarAviso} />}
      {vistaAdmin === "bloqueados" && puede("administrar_roles") && <IntentosBloqueados />}

      {aviso && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-[60]">{aviso}</div>
      )}

      {modalPersonal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
              <h3 className="font-semibold text-sm text-slate-700">Dar de alta personal</h3>
              <button onClick={() => setModalPersonal(false)} className="hover:bg-slate-100 rounded-lg p-1.5 text-slate-400 transition-colors"><X size={16} /></button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Nombre completo</label>
                <input className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm" value={formPersonal.nombre} onChange={(e) => setFormPersonal({ ...formPersonal, nombre: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Usuario (para iniciar sesión)</label>
                <input className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm" value={formPersonal.usuario} onChange={(e) => setFormPersonal({ ...formPersonal, usuario: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Contraseña (mínimo 6 caracteres)</label>
                <input type="password" className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm" value={formPersonal.password} onChange={(e) => setFormPersonal({ ...formPersonal, password: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Rol</label>
                <select className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm" value={formPersonal.rol_id} onChange={(e) => setFormPersonal({ ...formPersonal, rol_id: e.target.value })}>
                  <option value="">Selecciona un rol</option>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                </select>
              </div>
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

- [ ] **Step 2: Verificación manual**

Run: `npm run build` desde la raíz del repo.
Expected: build limpio, sin errores relacionados a `AdminRoles.jsx`.

Revisión de cableado (sin navegador disponible en este entorno):
- Confirmar que TODA la lógica y JSX de "Roles y Personal" que ya existía antes de este cambio está presente sin alteraciones dentro del bloque `{vistaAdmin === "roles" && (...)}` — comparar contra el archivo previo a este task para asegurar que no se perdió ningún handler (`agregarRol`, `editarNombreRol`, `eliminarRolActivo`, `clonarRolActivo`, `alternarPermiso`, `alternarModulo`, `guardarPersonal`, el modal de alta de personal).
- Confirmar que las pestañas "Ubicaciones de Tiendas" e "Intentos Bloqueados" solo se muestran (y solo son navegables) cuando `puede("administrar_roles")` es verdadero.
- Confirmar que `UbicacionesTiendas` excluye la sucursal `MercadoLibre` (`ciudad !== "Online"`) de su lista.

- [ ] **Step 3: Commit**

```bash
git add src/AdminRoles.jsx
git commit -m "feat: pantallas de Ubicaciones de Tiendas e Intentos Bloqueados en Roles y Personal"
```
