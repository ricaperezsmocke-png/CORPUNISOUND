# Plan de implementación — Cajas en el Punto de Venta

Spec: `docs/superpowers/specs/2026-09-01-cajas-punto-de-venta-design.md`
Rama: `feature/cajas-pos` · Base: `5cecef1`

Este trabajo toca **dinero, permisos y archivos compartidos**, así que va por fases con
revisión entre una y otra. Ninguna fase se despacha hasta que la anterior esté revisada.

---

## Fase 1 — El núcleo: cajas, ventas y corte (backend)

Es la fase que puede costar dinero si sale mal, y por eso va sola.

**Entregables**

1. `DB.pos.cajas` normalizada y sembrada: dos por sucursal, `Administrativa`
   (predeterminada) y `Fiscal`. Siembra idempotente, al estilo de
   `sembrarRolesIniciales` / `sembrarCategoriasGastos`. Detectar y gritar si una sucursal
   queda con dos predeterminadas o con ninguna.
2. `caja_id` en las ventas, con validación en el backend: la caja tiene que existir y
   pertenecer a la sucursal del alcance de la sesión. Sin caja declarada, cae en la
   `Administrativa` de su sucursal.
3. `caja_id` en los cortes, y `ventasDelTurno` filtrando por caja en vez de por sucursal.
4. **La absorción de las ventas históricas**: el corte de la `Administrativa` incluye las
   ventas de su sucursal con `caja_id` nulo. La `Fiscal` no las ve nunca.

**Archivos autorizados:** `backend/cortes.js`, `backend/ventas.js`, `backend/cajas.js`
(nuevo), `backend/server.js` (solo la siembra, la normalización de `DB.pos.cajas` y las
rutas de ventas/cortes que ya existen), y sus pruebas.

**Definition of Done:** todas las pruebas de la tabla del spec que no dependan de
interfaz, suite completa sin regresiones, eslint limpio.

---

## Fase 2 — La caja en la sesión y en la barra (frontend)

Depende de la Fase 1 revisada.

- `caja_activa` en `localStorage` junto a `sucursal_activa`, viajando al backend por el
  mismo camino (`src/api.js`).
- Indicador permanente en la barra superior junto al usuario; un clic cambia entre las
  dos cajas.
- Arranque siempre en `Administrativa`. Cambiar de sucursal reposiciona en la
  `Administrativa` de la nueva tienda.
- El Corte de Caja corta la caja de la sesión y lo dice en pantalla.

**Archivos autorizados:** `src/api.js`, la barra superior, `src/CorteCaja.jsx`,
`src/PuntoDeVenta.jsx` (solo lo necesario para mandar la caja).

---

## Fase 3 — Corregir la caja de una venta

Depende de la Fase 1 revisada (necesita la regla de "ya se cortó").

- Botón en la pantalla de consulta de ventas, donde hoy se cancela.
- Permiso nuevo `cambiar_caja_venta` (módulo `pos`) en `backend/permisosCatalogo.js`.
- **Se rechaza si la venta ya entró en un corte cerrado**, con el mismo criterio que usa
  `ventasDelTurno`.
- Queda constancia en la venta de quién la movió y cuándo.

---

## Verificación final, antes de que Victor apruebe

- Suite completa sin regresiones y eslint limpio.
- Revisión independiente del diff completo de la rama.
- **En navegador**: cobrar en las dos cajas de una misma tienda, corregir la caja de una
  venta, cortar ambas por separado y comprobar que los totales no se mezclan.
