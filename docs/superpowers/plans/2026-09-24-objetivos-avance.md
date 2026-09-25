# Mi Objetivo de Venta — Entrega A: gráficas de progreso — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **En este proyecto:** Codex implementa UNA task por despacho; Claude revisa el diff, corre las pruebas y commitea.
> Codex NO commitea, NO hace `git add`, NO stash, NO push.

**Goal:** Que la vendedora vea su avance (anillo, línea diaria contra ritmo, barras por meta con el % entero de su tienda) y
el gerente el de la tienda en cifras y por persona.

**Architecture:** Cálculo en un módulo puro nuevo `backend/objetivosAvance.js`, expuesto por UNA ruta nueva que recorta lo
que ve cada quien. En pantalla, funciones puras en `src/objetivos/avance.js` y dos componentes nuevos con Recharts
(ya instalado). `GerenciaVentas.jsx` solo gana dos pestañas.

**Tech Stack:** Node (`node --test`), React 18 + Vite, Recharts 3 (ver `src/PrediccionesDemanda.jsx`), lucide-react.

**Spec:** `docs/superpowers/specs/2026-09-24-objetivos-avance-design.md` (aprobado por Victor). Léelo antes de cualquier task.

## Global Constraints

- **Ninguna dependencia nueva.** Nada en `package.json`.
- **Ninguna línea de más de 200 caracteres** en `.js`/`.jsx`.
- **Ninguna regla ni ruta existente cambia.** Solo se agrega lo descrito.
- **Una vendedora nunca recibe cifras de tienda ni de otra persona**: solo sus cifras y porcentajes ENTEROS de tienda.
- Porcentaje = `Math.floor(centavos(capturado) * 100 / centavos(meta))` con `centavos = (n) => Math.round(Number(n) * 100)`;
  `null` si la meta es 0 o no existe.
- Días de calendario (no hay calendario laboral). Fechas de Chiapas: `fechaLocal()` en servidor, `hoyLocal()` en pantalla.
- Acentos UTF-8 correctos (sin mojibake). Todo en computadora.
- Pruebas backend por archivo: `node --preserve-symlinks --preserve-symlinks-main --test backend/<archivo>.test.js`.
  Pruebas de src: `node --preserve-symlinks --preserve-symlinks-main --test src/objetivos/<archivo>.test.js`.
  NO corras la suite completa (la corre Claude).

## Review Focus

- Vendedora de una tienda de dos personas: la respuesta de `/avance` no debe permitir deducir cuánto vendió la otra
  (sin cifras de tienda, solo enteros). → Task 2.
- Capturas corregidas: la serie diaria y los totales solo cuentan capturas VIGENTES de venta. → Task 1.
- Meta 0 o sin meta: nada divide entre cero; el anillo dice "Sin meta asignada este mes". → Tasks 1, 3, 4.
- Mes pasado: no se habla de "días que quedan"; mes futuro: no hay serie. → Task 3.
- Persona trasladada a mitad de mes: su avance en esta tienda cuenta solo lo capturado en esta tienda. → Task 1.

---

### Task 1: `backend/objetivosAvance.js` (cálculo puro)

**Files:** Create `backend/objetivosAvance.js`, `backend/objetivosAvance.test.js`.

**Interfaces — Produces:**
```js
porcentaje(capturado, meta)                                   // entero o null
avancePersona(DB, { mes, sucursal_id, vendedor_id })          // ver forma abajo
avanceTienda(DB, { mes, sucursal_id })                        // misma forma, cifras de tienda
soloPorcentajes(avance)                                       // sin cifras ni serie
avancePorPersona(DB, { mes, sucursal_id })                    // [{ vendedor_id, ...avancePersona sin serie }]
```
Forma de `avancePersona` / `avanceTienda`:
```js
{
  venta: { meta, capturado, porcentaje },
  serie: [{ fecha: "AAAA-MM-DD", monto }],                    // venta vigente sumada por día, ordenada
  marcas:      [{ marca_id, nombre, meta, capturado, porcentaje }],
  productos:   [{ producto_meta_id, nombre, meta, capturado, porcentaje }],
  creditos:    [{ financiera, etiqueta, meta, registrados, porcentaje }],
  actividades: [{ actividad, etiqueta, meta, declaradas, porcentaje }],
}
```
Forma de `soloPorcentajes`: `{ venta: porcentaje, marcas: [{ marca_id, nombre, porcentaje }], productos: [...],
creditos: [{ financiera, etiqueta, porcentaje }], actividades: [{ actividad, etiqueta, porcentaje }] }` — **sin** `meta`,
`capturado`, `registrados`, `declaradas` ni `serie`.

Reglas:
- Reutiliza lo que ya existe: `objetivoVigente` (`objetivos.js`), `capturadoDelMesPor` (`objetivosCaptura.js`),
  `resumenCreditos` (`objetivosCreditos.js`), `resumenActividades` (`objetivosActividades.js`), `listarElementos`
  (`objetivosCatalogos.js`, con `incluirInactivos: true` para nombres), `FINANCIERAS`, `CLASES_ACTIVIDAD`,
  `plantillaDelMes`.
- Persona: meta = su meta vigente (vendedor_id); elementos = los que tienen meta vigente de la persona o algo capturado /
  registrado por ella ese mes en esa tienda. Actividades: las 4 clases siempre.
- Tienda: meta = meta de tienda (vendedor_id null); capturado = suma de capturas VIGENTES de todas las personas en esa
  tienda y mes (aunque ya no estén en la plantilla); actividades con `resumenActividades` de tienda (conjunta cuenta 1).
  Elementos: los que tienen meta de tienda o algo capturado en la tienda.
- Todas las sumas de pesos en centavos enteros (como `restarEnCentavos` en `objetivosCierre.js`).
- `avancePorPersona`: personas únicas de `plantillaDelMes`, sin `serie`.

- [ ] Pruebas rojas: porcentaje con centavos (`29.99/30` → 99, `30/30` → 100, `45/30` → 150, meta 0 → null); serie
  suma solo venta vigente (una corregida no cuenta dos veces; capturas de marca no entran); persona trasladada solo cuenta
  su tienda; tienda suma a alguien que salió de la plantilla; actividades de tienda cuentan una conjunta una vez;
  `soloPorcentajes` no contiene ninguna de las claves de cifras (recórrelo y compruébalo); DB no se muta.
- [ ] Implementa, verde, detente y reporta.

---

### Task 2: ruta `GET /api/objetivos/:mes/:sucursalId/avance`

**Files:** Modify `backend/server.js` (SOLO: el `require` y la ruta nueva, declarada ANTES de
`GET /api/objetivos/:mes/:sucursalId` si hiciera falta por orden de rutas). Create `backend/objetivosAvanceRutas.test.js`
(copia el arranque de servidor real de `backend/objetivosMarcasRutas.test.js`).

- Control de acceso **idéntico** a `GET /api/objetivos/:mes/:sucursalId` (mismo `sucursalObjetivosPermitida`,
  `vendedorLigadoAObjetivos`, `alcancePropioPorPlantilla`, y 404 si no).
- Respuesta: `{ propio, tienda_porcentajes, tienda?, por_persona? }`.
  - `propio`: `avancePersona` del vendedor ligado (null si no está ligado o no estuvo en la plantilla de esa tienda/mes).
  - `tienda_porcentajes`: `soloPorcentajes(avanceTienda(...))`.
  - `tienda` y `por_persona`: SOLO si tiene `editar_objetivos_venta` **y** alcance normal en esa tienda.
- Nunca uses `?sucursal_id=` como fuente del alcance.

- [ ] Pruebas rojas (servidor real): vendedora recibe su `propio` y `tienda_porcentajes`, y la respuesta **no** contiene
  `tienda` ni `por_persona` ni ninguna cifra de otra persona (busca su monto en el JSON crudo); gerente con alcance recibe
  todo; gerente de otra tienda → 404; vendedora de otra tienda → 404; ids como texto; `?sucursal_id=` de otra tienda no
  cambia nada; mes inválido → 400.
- [ ] Implementa, verde (`objetivosAvanceRutas.test.js`, `objetivosRutas.test.js`, `objetivosMarcasRutas.test.js`),
  detente y reporta.

---

### Task 3: `src/objetivos/avance.js` (cálculo de pantalla)

**Files:** Create `src/objetivos/avance.js`, `src/objetivos/avance.test.js`.

**Interfaces — Produces:**
```js
diasDelMes(mes)                                   // 28..31
diasRestantes(mes, hoy)                           // mes actual: días desde hoy (incluido) al fin; pasado: 0; futuro: diasDelMes
serieConRitmo(serie, meta, mes, hoy)              // [{ dia, fecha, acumulado, ritmo }] del día 1 al fin de mes;
                                                  // acumulado = null en días futuros; ritmo = meta*dia/diasDelMes (centavos)
faltantePorDia(meta, capturado, dias)             // { faltante, porDia } o null si meta<=0, dias<=0 o faltante<=0
estadoMeta(meta, capturado)                       // "sin-meta" | "en-camino" | "lograda"
```
- [ ] Pruebas rojas: febrero bisiesto y diciembre; hoy fuera del mes; serie con huecos (días sin captura mantienen el
  acumulado); faltante con centavos; meta 0; mes pasado (días restantes 0 → `faltantePorDia` null).
- [ ] Implementa, verde, detente y reporta.

---

### Task 4: pestaña "Mi avance" (vendedora)

**Files:** Create `src/objetivos/AvanceVendedor.jsx`. Modify `src/GerenciaVentas.jsx` (SOLO: agregar la pestaña
`mi-avance` "Mi avance" con icono `Gauge` como PRIMERA de la persona ligada, y renderizar el componente en ella).

```jsx
export default function AvanceVendedor({ mes, sucursalId })   // hace su propio GET .../avance
```
- **Anillo** (Recharts `PieChart` con dos sectores o `RadialBarChart`): porcentaje grande al centro y
  "$capturado de $meta" debajo (`pesosConCentavos` de `src/objetivos/marcas.js`). `estadoMeta === "sin-meta"` →
  "Sin meta asignada este mes". Más de 100 %: el anillo lleno y el número real (ej. 118 %).
- **Línea** (`LineChart`): `acumulado` (línea continua) y `ritmo` (punteada) con `serieConRitmo`. Debajo el texto con
  `faltantePorDia` y `diasRestantes`: "Te faltan $X; son $Y por día en los N días que quedan" / "¡Llegaste a tu meta!" /
  en mes pasado solo "Terminó el mes con N %".
- **Barras**: por cada marca, producto, financiera y actividad del `propio`, una barra de su porcentaje con la cifra
  ("$4,000 de $5,000", "2 de 3 piezas", "1 de 4 créditos", "3 de 5 declaradas") y, junto, una barra gris "Tienda: N %"
  tomada de `tienda_porcentajes` (misma referencia). Actividades con el aviso "Declaradas, no verificadas".
- Errores del servidor tal cual. Sin cifras de tienda en ninguna parte.

- [ ] build + lint + `avance.test.js`; detente y reporta (Claude prueba en navegador).

---

### Task 5: pestaña "Avance de la tienda" (jefatura)

**Files:** Create `src/objetivos/AvanceTienda.jsx`. Modify `src/GerenciaVentas.jsx` (SOLO: pestaña `tienda-avance`
"Avance de la tienda" con icono `BarChart3` como PRIMERA de la familia de jefatura, y renderizarla).

```jsx
export default function AvanceTienda({ mes, sucursalId, nombre })   // GET .../avance, usa tienda y por_persona
```
- Mismo anillo, línea y barras que la Task 4 pero con las cifras de `tienda` (sin barra gris).
- **Tabla por persona** (`por_persona`): fila por persona con `nombre(vendedor_id)`; columnas venta y cada meta que
  exista en la tienda, cada celda con porcentaje, cifra y una barrita. `null` → "—".
- Reutiliza los subcomponentes de la Task 4 (extráelos a `src/objetivos/GraficasAvance.jsx` si hace falta en vez de
  copiar).

- [ ] build + lint; detente y reporta.

---

## Detente y reporta (no improvises) si
- Un dato que la pantalla necesita no está en la respuesta descrita, o hay que tocar una ruta existente.
- Cumplir algo obliga a tocar un archivo no listado, `package.json` o una prueba existente.

## Evidencia de entrega (por task)
Archivos cambiados; salida resumida de las pruebas corridas; build y lint si aplica; lo que no pudiste comprobar.

## Después
Claude revisa y commitea cada task, prueba en navegador (vendedora y gerente, mes actual, mes pasado y meta 0), y pide
una revisión independiente que NO sea de Codex; luego merge de Victor.
