# Mi Objetivo de Venta — Entrega B: pantallas de marcas, productos y créditos — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **En este proyecto:** Codex implementa cada task; Claude revisa el diff, corre las pruebas y commitea. Codex NO commitea, NO hace `git add`, NO stash, NO push.

**Goal:** Que vendedora, gerente y administradora puedan usar desde pantalla las metas de marca (pesos), producto (piezas) y crédito (Coppel Pay / Atrato) cuyo servidor ya existe.

**Architecture:** Lógica pura y probada en `src/objetivos/marcas.js`; componentes React nuevos y autocontenidos (cada uno hace sus propias peticiones, como `ActividadesGerente.jsx`); `GerenciaVentas.jsx` gana una barra de pestañas y `CierreObjetivos.jsx` gana los tres grupos, centavos y confirmación. Ninguna ruta ni regla del servidor cambia.

**Tech Stack:** React 18 + Vite, Tailwind, `lucide-react` (iconos, ya instalado), `node --test` para las funciones puras de `src/`.

**Spec:** `docs/superpowers/specs/2026-09-24-objetivos-pantallas-marcas-design.md` (aprobado por Victor 2026-09-24). Léelo completo antes de empezar cualquier task.

## Global Constraints

- **Ninguna dependencia nueva.** Nada en `package.json`.
- **Ninguna línea de más de 200 caracteres** en `.js`/`.jsx`. Un `className` largo se extrae a una constante.
- **No tocar `backend/`.** Si una pantalla necesita algo que el servidor no da, **detente y reporta**.
- Acentos UTF-8 correctos en la interfaz (nada de mojibake: "Público", no "PÃºblico"). Textos en español.
- Estilo con las clases existentes: `neu`, `neu-panel`, `neu-campo`, `neu-boton` (ver `src/index.css`).
- Todo se usa en **computadora**: tablas completas, sin diseño de celular; basta con que no se rompa angosto.
- Peticiones con `apiFetch` (`src/api.js`) y errores con `leer` (`src/objetivos/datos.js`). **Nunca** mandes
  `?sucursal_id=` como fuente de alcance; los ids van en la ruta como ya lo hacen las pantallas actuales.
- Una meta, captura o crédito **por petición**. No hay "Guardar todo".
- El mes cerrado (`objetivos.cerrado`) deja todo en **solo lectura**.
- Pruebas de `src/` por archivo: `node --test src/objetivos/<archivo>.test.js`.
- Build: `npx vite build`. Lint: `npx eslint src/objetivos src/GerenciaVentas.jsx src/CierreObjetivos.jsx --quiet` → 0 errores.

## Review Focus

- La vendedora con capturas de marca en su historial: la tabla y el total de **venta** no deben incluir renglones de marca/producto (el servidor ya los mezcla en `capturas`). → Task 1.
- Cierre sellado con una rectificación de marca: la fila de **venta** de esa persona no debe cambiar. → Task 1.
- Crédito con folio "CP-123" cuando ya existe "CP123": el mensaje del servidor se muestra tal cual y la lista no cambia. → Task 4.
- Gerente de UNA tienda (sin `ver_todas_las_sucursales`): no ve el panel de listas ni sus botones. → Task 6.
- Cierre con una persona que tiene créditos pero ninguna meta: sus reales de crédito se piden y se envían. → Task 7.

---

## Datos que ya da el servidor (no inventes otros)

- `GET /api/objetivos/:mes/:sucursalId` → además de lo actual, `marcas`, `productos`, `creditos`: arreglos
  **solo de elementos con meta vigente ese mes**. Cada elemento:
  - marca: `{ marca_id, nombre, meta_tienda, asignado, sin_asignar, lineas: [{ vendedor_id, monto }] }`
  - producto: `{ producto_meta_id, nombre, meta_tienda, asignado, sin_asignar, lineas }`
  - crédito: `{ financiera, etiqueta, meta_tienda, asignado, sin_asignar, lineas }`
  Para quien no es jefatura con alcance: solo sus propias `lineas` y **sin** `meta_tienda/asignado/sin_asignar`.
- `GET /api/objetivos/catalogo/marcas` y `/catalogo/productos` → `[{ id, nombre, activo, ... }]` (solo activos;
  `?inactivos=1` devuelve todos solo a quien tiene `editar_objetivos_venta` + `ver_todas_las_sucursales`).
- `POST /api/objetivos/catalogo/:lista` `{ nombre }` y `POST /api/objetivos/catalogo/:lista/:id/desactivar`.
- `GET /api/objetivos/financieras` → `[{ clave: "coppel_pay", etiqueta: "Coppel Pay" }, { clave: "atrato", etiqueta: "Atrato" }]`.
- `GET /api/objetivos/:mes/:sucursalId/capturas/:vendedorId` → `{ capturas, total_capturado, total_por_marca:
  [{ marca_id, total_capturado }], total_por_producto: [{ producto_meta_id, total_capturado }], dias_sin_capturar }`.
  **`capturas` trae venta, marca y producto mezclados**; cada captura tiene `tipo` (`"venta"`, `"marca"`,
  `"producto"`; capturas viejas pueden no traer `tipo` = venta), `fecha`, `monto`, `vigente`, `corrige_a`,
  `motivo`, `capturado_por`, `capturado_en`, y `marca_id` / `producto_meta_id` según el tipo.
- `POST /api/objetivos/captura` `{ tipo, mes, fecha, sucursal_id, vendedor_id, monto, marca_id? , producto_meta_id? }`
  y `POST /api/objetivos/captura/:id/corregir` `{ monto, motivo }`.
- `GET .../creditos/:vendedorId` → `{ registros, resumen: [{ financiera, etiqueta, registrados }] }`; cada registro
  `{ id, fecha, financiera, folio, monto, nota, registrado_por, registrado_en, vigente, anulado_por, anulado_en, motivo_anulacion }`.
- `GET .../creditos` → registros de la tienda (solo jefatura/cierre con alcance).
- `POST /api/objetivos/credito` `{ mes, fecha, sucursal_id, vendedor_id, financiera, folio, monto, nota }`;
  `POST /api/objetivos/credito/:id/anular` `{ motivo }`.
- `POST /api/objetivos` `{ tipo, mes, sucursal_id, vendedor_id|null, monto, motivo?, marca_id|producto_meta_id|financiera }`.
- `GET .../historial/:vendedorId|tienda` y `GET .../sugerencia` aceptan `?tipo=marca&marca_id=…`,
  `?tipo=producto&producto_meta_id=…`, `?tipo=credito&financiera=…`.
- `GET .../previo-cierre` → cada línea trae además `marcas: [{ marca_id, nombre, meta, capturado }]`,
  `productos: [{ producto_meta_id, nombre, meta, capturado }]`, `creditos: [{ financiera, meta, registrados }]`.
- `POST /api/objetivos/cierre` → cada real: `{ vendedor_id, real_sicar, marcas: [{ marca_id, real }],
  productos: [{ producto_meta_id, real }], creditos: [{ financiera, real }] }`. Falta uno → 400.
- Cierre sellado: cada línea trae `marcas/productos/creditos` con `real` y `diferencia`; `rectificaciones` de
  elemento traen `marca_id` / `producto_meta_id` / `financiera` y `campo` ∈ `real|meta|capturado`.
- `POST /api/objetivos/cierre/:id/rectificar` `{ vendedor_id, campo, valor_nuevo, motivo, marca_id?|producto_meta_id?|financiera? }`.

---

### Task 1: Funciones puras + los dos defectos escondidos

**Files:**
- Create: `src/objetivos/marcas.js`, `src/objetivos/marcas.test.js`
- Modify: `src/objetivos/CapturaVendedor.jsx` (solo filtrar a venta), `src/CierreObjetivos.jsx` (solo el cálculo de `vigente` de la fila de venta en `CierreSellado`)

**Interfaces — Produces (las usan las tasks 3-7):**
```js
export const ETIQUETAS_FINANCIERA = { coppel_pay: "Coppel Pay", atrato: "Atrato" };
export function esCapturaDeVenta(captura)                 // boolean: tipo ausente o "venta"
export function pesosConCentavos(n)                       // "$1,234.50"
export function textoPendiente(sinAsignar, unidad)        // unidad: "pesos" | "piezas" | "creditos"
export function capturasDelDia(capturas, fecha, tipo)     // vigentes de ese día y tipo
export function resumenMarcasDelDia(capturas, fecha)      // { venta: number|null, enMarcas: number }
export function esRectificacionDeElemento(r)              // boolean
export function vigenteDeElemento(elemento, rectificaciones, clave)  // { meta, capturado, real }
export function armarRealesCierre(previo, valores)        // cuerpo `reales` del POST /cierre
export function camposFaltantesCierre(previo, valores)    // [llave] de campos vacíos
export function llaveCampo(vendedorId, grupo, id)         // "7|marcas|3" ; grupo "sicar" usa id ""
```

- [ ] **Step 1: Escribe las pruebas que fallan** en `src/objetivos/marcas.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  esCapturaDeVenta, pesosConCentavos, textoPendiente, capturasDelDia, resumenMarcasDelDia,
  esRectificacionDeElemento, vigenteDeElemento, armarRealesCierre, camposFaltantesCierre, llaveCampo,
} from "./marcas.js";

test("una captura sin tipo es de venta; marca y producto no", () => {
  assert.equal(esCapturaDeVenta({ monto: 1 }), true);
  assert.equal(esCapturaDeVenta({ tipo: "venta" }), true);
  assert.equal(esCapturaDeVenta({ tipo: "marca", marca_id: 1 }), false);
  assert.equal(esCapturaDeVenta({ tipo: "producto", producto_meta_id: 1 }), false);
});

test("los pesos del cierre llevan centavos", () => {
  assert.equal(pesosConCentavos(1234.5), "$1,234.50");
  assert.equal(pesosConCentavos(0), "$0.00");
  assert.equal(pesosConCentavos(null), "$0.00");
});

test("el pendiente del reparto se dice con palabras, nunca negativo", () => {
  assert.equal(textoPendiente(0, "pesos"), "Reparto completo");
  assert.equal(textoPendiente(1500, "pesos"), "Faltan $1,500.00 por repartir");
  assert.equal(textoPendiente(-2, "piezas"), "Asignaste 2 piezas de más");
  assert.equal(textoPendiente(1, "creditos"), "Falta 1 crédito por repartir");
  assert.equal(textoPendiente(3, "creditos"), "Faltan 3 créditos por repartir");
});

const capturas = [
  { id: 1, tipo: "venta", fecha: "2026-09-10", monto: 8500, vigente: true },
  { id: 2, tipo: "marca", marca_id: 1, fecha: "2026-09-10", monto: 4000, vigente: true },
  { id: 3, tipo: "marca", marca_id: 2, fecha: "2026-09-10", monto: 2000, vigente: true },
  { id: 4, tipo: "marca", marca_id: 2, fecha: "2026-09-10", monto: 9000, vigente: false },
  { id: 5, tipo: "producto", producto_meta_id: 1, fecha: "2026-09-10", monto: 2, vigente: true },
  { id: 6, fecha: "2026-09-11", monto: 100, vigente: true },
];

test("capturas del día filtra por fecha, tipo y vigencia", () => {
  assert.deepEqual(capturasDelDia(capturas, "2026-09-10", "marca").map((c) => c.id), [2, 3]);
  assert.deepEqual(capturasDelDia(capturas, "2026-09-11", "venta").map((c) => c.id), [6]);
});

test("el letrero de marcas compara lo capturado con la venta vigente del día", () => {
  assert.deepEqual(resumenMarcasDelDia(capturas, "2026-09-10"), { venta: 8500, enMarcas: 6000 });
  assert.deepEqual(resumenMarcasDelDia(capturas, "2026-09-12"), { venta: null, enMarcas: 0 });
});

test("una rectificación con referencia es de elemento, no de venta", () => {
  assert.equal(esRectificacionDeElemento({ campo: "meta" }), false);
  assert.equal(esRectificacionDeElemento({ campo: "meta", marca_id: 3 }), true);
  assert.equal(esRectificacionDeElemento({ campo: "real", financiera: "atrato" }), true);
  assert.equal(esRectificacionDeElemento({ campo: "real", producto_meta_id: 0 }), true);
});

test("el vigente de un elemento aplica solo sus rectificaciones, en orden", () => {
  const marca = { marca_id: 3, meta: 100, capturado: 80, real: 70 };
  const rect = [
    { campo: "real", marca_id: 3, valor_nuevo: 75 },
    { campo: "real", marca_id: 4, valor_nuevo: 1 },
    { campo: "meta", valor_nuevo: 999 },
    { campo: "real", marca_id: 3, valor_nuevo: 78 },
  ];
  assert.deepEqual(vigenteDeElemento(marca, rect, "marca_id"), { meta: 100, capturado: 80, real: 78 });
  const credito = { financiera: "atrato", meta: 2, registrados: 1, real: 1 };
  assert.deepEqual(vigenteDeElemento(credito, [{ campo: "capturado", financiera: "atrato", valor_nuevo: 2 }], "financiera"),
    { meta: 2, capturado: 2, real: 1 });
});

const previo = [{
  vendedor_id: 7, meta: 1000, capturado: 900,
  marcas: [{ marca_id: 3, nombre: "Yamaha", meta: 500, capturado: 400 }],
  productos: [{ producto_meta_id: 1, nombre: "Teclados", meta: 2, capturado: 1 }],
  creditos: [{ financiera: "coppel_pay", meta: 0, registrados: 1 }],
}];

test("el cuerpo del cierre lleva SICAR y los tres grupos con números", () => {
  const valores = {
    [llaveCampo(7, "sicar", "")]: "950.5", [llaveCampo(7, "marcas", 3)]: "410",
    [llaveCampo(7, "productos", 1)]: "1", [llaveCampo(7, "creditos", "coppel_pay")]: "1",
  };
  assert.deepEqual(armarRealesCierre(previo, valores), [{
    vendedor_id: 7, real_sicar: 950.5,
    marcas: [{ marca_id: 3, real: 410 }],
    productos: [{ producto_meta_id: 1, real: 1 }],
    creditos: [{ financiera: "coppel_pay", real: 1 }],
  }]);
});

test("un campo vacío del cierre se reporta; cero no es vacío", () => {
  const valores = {
    [llaveCampo(7, "sicar", "")]: "0", [llaveCampo(7, "marcas", 3)]: "",
    [llaveCampo(7, "productos", 1)]: "0",
  };
  assert.deepEqual(camposFaltantesCierre(previo, valores), [llaveCampo(7, "marcas", 3), llaveCampo(7, "creditos", "coppel_pay")]);
});
```

- [ ] **Step 2: Corre y confirma que falla** — `node --test src/objetivos/marcas.test.js` → falla porque `./marcas.js` no existe.

- [ ] **Step 3: Implementa `src/objetivos/marcas.js`:**

```js
export const ETIQUETAS_FINANCIERA = { coppel_pay: "Coppel Pay", atrato: "Atrato" };
const REFERENCIAS = ["marca_id", "producto_meta_id", "financiera"];
const GRUPOS = [
  { grupo: "marcas", clave: "marca_id" },
  { grupo: "productos", clave: "producto_meta_id" },
  { grupo: "creditos", clave: "financiera" },
];

export const esCapturaDeVenta = (captura) => captura.tipo === undefined || captura.tipo === null || captura.tipo === "venta";

export const pesosConCentavos = (n) => Number(n || 0).toLocaleString("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: 2,
});

function cantidad(n, unidad) {
  if (unidad === "pesos") return pesosConCentavos(n);
  if (unidad === "piezas") return `${n} ${n === 1 ? "pieza" : "piezas"}`;
  return `${n} ${n === 1 ? "crédito" : "créditos"}`;
}

export function textoPendiente(sinAsignar, unidad) {
  const n = Number(sinAsignar) || 0;
  if (n === 0) return "Reparto completo";
  if (n < 0) return `Asignaste ${cantidad(-n, unidad)} de más`;
  return `${n === 1 && unidad !== "pesos" ? "Falta" : "Faltan"} ${cantidad(n, unidad)} por repartir`;
}

const tipoDe = (c) => (esCapturaDeVenta(c) ? "venta" : c.tipo);

export const capturasDelDia = (capturas, fecha, tipo) =>
  capturas.filter((c) => c.vigente && c.fecha === fecha && tipoDe(c) === tipo);

export function resumenMarcasDelDia(capturas, fecha) {
  const venta = capturasDelDia(capturas, fecha, "venta")[0];
  const enMarcas = capturasDelDia(capturas, fecha, "marca").reduce((s, c) => s + Number(c.monto), 0);
  return { venta: venta ? Number(venta.monto) : null, enMarcas };
}

export const esRectificacionDeElemento = (r) => REFERENCIAS.some((clave) => r[clave] !== undefined && r[clave] !== null);

export function vigenteDeElemento(elemento, rectificaciones, clave) {
  const vigente = { meta: elemento.meta, capturado: elemento.capturado ?? elemento.registrados, real: elemento.real };
  for (const r of rectificaciones) {
    if (r[clave] !== undefined && r[clave] === elemento[clave]) vigente[r.campo] = r.valor_nuevo;
  }
  return vigente;
}

export const llaveCampo = (vendedorId, grupo, id) => `${vendedorId}|${grupo}|${id}`;

export function armarRealesCierre(previo, valores) {
  return previo.map((linea) => {
    const real = { vendedor_id: linea.vendedor_id, real_sicar: Number(valores[llaveCampo(linea.vendedor_id, "sicar", "")]) };
    for (const { grupo, clave } of GRUPOS) {
      real[grupo] = (linea[grupo] || []).map((e) => ({
        [clave]: e[clave], real: Number(valores[llaveCampo(linea.vendedor_id, grupo, e[clave])]),
      }));
    }
    return real;
  });
}

export function camposFaltantesCierre(previo, valores) {
  const vacio = (llave) => valores[llave] === undefined || String(valores[llave]).trim() === "";
  const faltan = [];
  for (const linea of previo) {
    const llaves = [llaveCampo(linea.vendedor_id, "sicar", "")];
    for (const { grupo, clave } of GRUPOS) {
      for (const e of linea[grupo] || []) llaves.push(llaveCampo(linea.vendedor_id, grupo, e[clave]));
    }
    faltan.push(...llaves.filter(vacio));
  }
  return faltan;
}
```

- [ ] **Step 4: Corre y confirma verde** — `node --test src/objetivos/marcas.test.js` → todas pasan.

- [ ] **Step 5: Defecto 1 — la venta de la vendedora no debe mezclar marcas.** En `src/objetivos/CapturaVendedor.jsx`,
  importa `esCapturaDeVenta` y en la tabla usa `capturas.capturas.filter(esCapturaDeVenta)` en lugar de
  `capturas.capturas`. Nada más cambia en ese archivo en esta task.

- [ ] **Step 6: Defecto 2 — una rectificación de marca no toca la fila de venta.** En `src/CierreObjetivos.jsx`,
  dentro de `CierreSellado`, la línea
  `const rectificaciones = cierre.rectificaciones.filter((r) => r.vendedor_id === l.vendedor_id);`
  pasa a excluir las de elemento:
  `...filter((r) => r.vendedor_id === l.vendedor_id && !esRectificacionDeElemento(r));`
  Haz lo mismo en la lista de rectificaciones que se muestra abajo **solo si** esa lista rotula el campo con
  `nombresCampos` (una de elemento se mostrará en la Task 7; mientras, no debe rotularse como venta).

- [ ] **Step 7: Verifica** — `node --test src/objetivos/marcas.test.js src/objetivos/datos.test.js src/objetivos/actividades.test.js`,
  `npx vite build`, lint de Global Constraints. Detente y reporta (Claude commitea).

---

### Task 2: Barra de pestañas en "Mi Objetivo de Venta"

**Files:** Modify `src/GerenciaVentas.jsx`. Create `src/objetivos/Pestanas.jsx`.

**Interfaces — Produces:**
```jsx
// src/objetivos/Pestanas.jsx
export default function Pestanas({ pestanas, activa, elegir })
// pestanas: [{ clave: string, etiqueta: string, Icono: componente de lucide-react }]
```

Requisitos:
- Botones grandes con el icono **arriba** del texto (estilo barra de SICAR), `neu-boton`; la activa se distingue
  (fondo azul claro o borde azul) y tiene `aria-pressed="true"`. Contenedor con `role="toolbar"`.
- En `GerenciaVentas.jsx`, estado `const [pestana, setPestana] = useState(null)` y la lista se arma así:
  - si `miVendedorId != null`: `mi-venta` "Mi venta" (icono `Target`), `mis-actividades` "Mis actividades"
    (`Megaphone`), `mis-creditos` "Mis créditos" (`CreditCard`);
  - si `esJefatura && (veTodas || Number(sucursalId) === Number(usuario?.sucursal_id))`: `tienda-venta`
    "Venta de la tienda" (`Store`), `tienda-actividades` "Actividades de la tienda" (`Users`),
    `tienda-marcas` "Marcas, productos y créditos" (`Tags`).
  - La activa es `pestana` si está en la lista; si no, la primera de la lista. **No** se reinicia al cambiar de mes
    o sucursal (solo cae a la primera si deja de existir).
- Cada sección existente se muestra solo en su pestaña, **sin cambiarle props ni contenido**: `CapturaVendedor` en
  `mi-venta`, `ActividadesVendedor` en `mis-actividades`, `RepartoGerente` en `tienda-venta`, `ActividadesGerente`
  en `tienda-actividades`. `mis-creditos` y `tienda-marcas` muestran por ahora un párrafo
  "Disponible en la siguiente versión." (lo reemplazan las tasks 4 y 5).
- Selector de mes/sucursal, errores, avisos y modales quedan **fuera** de las pestañas, como hoy.

- [ ] **Step 1:** Implementa `Pestanas.jsx` y el cableado.
- [ ] **Step 2:** `npx vite build` y lint. Detente y reporta (esta task no tiene lógica pura que probar; Claude la
  verifica en navegador).

---

### Task 3: "¿De qué marcas fue?" y "Piezas por producto" (vendedora)

**Files:** Create `src/objetivos/MarcasDelDia.jsx`. Modify `src/GerenciaVentas.jsx` (renderizarlo en `mi-venta` debajo de
`CapturaVendedor` y pasarle lo necesario). **No** modificar `CapturaVendedor.jsx`.

**Interfaces — Consumes:** `capturasDelDia`, `resumenMarcasDelDia`, `pesosConCentavos` (Task 1).
```jsx
export default function MarcasDelDia({ mes, sucursalId, vendedorId, fecha, objetivos, capturas, actualizar })
// objetivos: respuesta de GET /objetivos/:mes/:sucursalId ; capturas: respuesta de GET .../capturas/:vendedorId
// actualizar: () => Promise — la recarga silenciosa de GerenciaVentas (cargar({ silenciosa: true }))
```

Requisitos (spec §2.1):
- Usa la `fecha` que ya elige la captura de venta. Encabezado: "Marcas y productos del {fecha}".
- Carga una vez `GET /api/objetivos/catalogo/marcas` y `/catalogo/productos` (activos).
- **Bloque Marcas (pesos):** renglones = marcas con línea propia en `objetivos.marcas` (su `lineas` trae la de la
  persona) ∪ marcas ya capturadas ese día ∪ marcas agregadas con "+ otra marca" (selector con las activas que aún
  no están). Cada renglón: nombre, meta del mes de la persona (si tiene), total del mes (`total_por_marca`), y:
  - si ya hay captura vigente ese día: el monto y botón **Corregir**;
  - si no: campo numérico (`min="0" step="any"`) y botón **Guardar** que hace `POST /api/objetivos/captura` con
    `{ tipo: "marca", marca_id, mes, fecha, sucursal_id: Number(sucursalId), vendedor_id: vendedorId, monto: Number(valor) }`.
- Letrero: `De tu venta de {pesosConCentavos(venta)} llevas {pesosConCentavos(enMarcas)} en marcas` con
  `resumenMarcasDelDia`. Si lo tecleado en un renglón haría pasar la venta, aviso ámbar antes de enviar (el servidor
  decide; no bloquees el botón por esto).
- Si `venta === null`: el bloque de marcas se ve deshabilitado con "Primero captura tu venta de ese día".
- **Bloque Productos (piezas):** igual con `objetivos.productos`, `catalogo/productos`, `total_por_producto`,
  `tipo: "producto"`, `producto_meta_id`, campo `step="1"`; sin letrero ni dependencia de la venta.
- **Corregir:** diálogo con `Modal` y `Campo` de `DialogosObjetivos.jsx`: "Corregir {nombre} del {fecha}", monto
  correcto y **motivo obligatorio**; `POST /api/objetivos/captura/:id/corregir` `{ monto: Number, motivo }`.
- Cada acción muestra su error del servidor **tal cual**, junto al renglón o en el diálogo, y al tener éxito llama
  `actualizar()`. Un renglón que falla no borra lo tecleado en los demás.
- Mes cerrado: solo lectura (sin campos, sin Guardar, sin Corregir, sin "+ otra marca").
- Debajo, historial compacto de capturas de marca/producto del mes (fecha, elemento, monto/piezas, estado
  Vigente/Corregida/Corrección con motivo, quién) — mismo criterio visual que la tabla de venta.

- [ ] **Step 1:** Implementa. **Step 2:** build + lint + `node --test src/objetivos/marcas.test.js`. Detente y reporta.

---

### Task 4: "Mis créditos" (vendedora)

**Files:** Create `src/objetivos/CreditosVendedor.jsx`. Modify `src/GerenciaVentas.jsx` (reemplaza el párrafo de `mis-creditos`).

```jsx
export default function CreditosVendedor({ mes, sucursalId, vendedorId, objetivos })
```

Requisitos (spec §2.2):
- Carga `GET /api/objetivos/financieras` y `GET /api/objetivos/:mes/:sucursalId/creditos/:vendedorId`; recarga esta
  última tras cada registro o anulación (no dependas de la recarga de `GerenciaVentas`).
- Resumen arriba: por financiera, `registrados` y, si la persona tiene línea en `objetivos.creditos`, "de {meta}".
- Formulario: financiera (select), fecha (`type="date"`, hoy por defecto con `hoyLocal()`, `min` = primer día del mes,
  `max` = hoy), monto (`min="0.01" step="any"`), folio (obligatorio), nota opcional (`maxLength=300`). Botón
  "Registrar crédito" deshabilitado si falta financiera, fecha, monto o folio. `POST /api/objetivos/credito` con
  `{ mes, fecha, sucursal_id: Number(sucursalId), vendedor_id: vendedorId, financiera, folio, monto: Number(monto), nota }`.
- Error del servidor (folio repetido incluido) **tal cual**, sin limpiar el formulario. Éxito: limpia folio, monto y nota.
- Tabla del mes: fecha, financiera (etiqueta), folio, monto (`pesosConCentavos`), nota, registró. Anulados en gris
  y **tachados** con "Anulado por {anulado_por} el {fecha}: {motivo_anulacion}". Nunca se ocultan.
- **Anular** (solo vigentes, mes abierto): `Modal` con motivo obligatorio → `POST /api/objetivos/credito/:id/anular` `{ motivo }`.
- Mes cerrado: sin formulario ni botón Anular.

- [ ] **Step 1:** Implementa. **Step 2:** build + lint. Detente y reporta.

---

### Task 5: "Marcas, productos y créditos" (gerente)

**Files:** Create `src/objetivos/MarcasGerente.jsx`. Modify `src/GerenciaVentas.jsx` (reemplaza el párrafo de `tienda-marcas`).

**Interfaces — Consumes:** `textoPendiente`, `pesosConCentavos`, `ETIQUETAS_FINANCIERA` (Task 1); `sugerenciaGuardada`,
`leer` (`datos.js`); `Modal`, `Campo`, `HistorialMetas` (`DialogosObjetivos.jsx`).
```jsx
export default function MarcasGerente({ mes, sucursalId, objetivos, nombre, actualizar, permisos })
// nombre: (vendedorId) => string ; actualizar: recarga silenciosa ; permisos: arreglo de claves
```

Requisitos (spec §3):
- **Tabla única**: filas = `objetivos.marcas` (unidad pesos), `objetivos.productos` (piezas), `objetivos.creditos`
  (créditos, nombre = `etiqueta`). Columnas: Tipo · Elemento · Unidad · Meta de tienda · Asignado · Pendiente
  (`textoPendiente`). Pesos con `pesosConCentavos`.
- **"+ Agregar meta"** (mes abierto): diálogo con tipo (Marca/Producto/Crédito) → elemento de la lista (marcas o
  productos **activos** de `catalogo/:lista`, o las dos financieras) → monto de la meta de tienda. Solo se pueden
  elegir elementos que aún no tienen fila. `POST /api/objetivos` con `vendedor_id: null` y la referencia.
- Al hacer clic en una fila: panel "Reparto de {elemento}" con una fila por persona de `lineas` (nombre, meta),
  botones **Editar**, **Historial**, y arriba **Cambiar meta de tienda**, **Sugerir reparto**.
  - Editar/cambiar: lee primero `GET .../historial/{vendedorId|tienda}?tipo=…&{clave}=…`; si hay versiones, el
    diálogo exige **motivo**. `POST /api/objetivos` con `{ tipo, mes, sucursal_id, vendedor_id, monto, motivo?, [clave]: id }`.
  - Sugerir: `GET .../sugerencia?tipo=…&{clave}=…` → junto a cada persona "Sugerido: X" y botón **Usar sugerencia**
    (abre el diálogo con ese monto) y la marca **Guardada** cuando `sugerenciaGuardada(sug, lineas)`; si no,
    "Pendiente de guardar". La sugerencia se conserva tras guardar una parte (no la borres en la recarga silenciosa)
    y se descarta al cambiar la meta de tienda o de fila.
  - Historial: `HistorialMetas` con los datos de la ruta de historial.
- **Créditos de la tienda**: tabla de `GET .../creditos` (persona con `nombre()`, financiera, folio, fecha, monto,
  estado con motivo si anulado). Solo lectura.
- Tras cada guardado: `actualizar()`. Errores del servidor tal cual. Mes cerrado: solo lectura.
- Deja un lugar al final (`{/* listas */}`) donde la Task 6 insertará el panel de listas.

- [ ] **Step 1:** Implementa. **Step 2:** build + lint. Detente y reporta.

---

### Task 6: Panel de listas de marcas y productos

**Files:** Create `src/objetivos/ListasObjetivos.jsx`. Modify `src/objetivos/MarcasGerente.jsx` (insertarlo donde dejó el lugar).

```jsx
export default function ListasObjetivos({ onCambio })  // onCambio: recarga el catálogo del gerente tras alta/desactivar
```

Requisitos (spec §4):
- `MarcasGerente` lo muestra **solo si** `permisos.includes("editar_objetivos_venta") && permisos.includes("ver_todas_las_sucursales")`.
  Si no, no aparece nada (ni botones ni encabezado).
- Dos columnas: Marcas y Productos. Cada una carga `GET /api/objetivos/catalogo/{lista}?inactivos=1`, lista activos
  e inactivos (inactivos en gris con "Desactivada"), un campo + botón **Agregar** (`POST /api/objetivos/catalogo/{lista}`
  `{ nombre }`, máx. 60 caracteres) y **Desactivar** por elemento activo (`POST …/{id}/desactivar`, con confirmación
  en un `Modal`: "Lo ya capturado conserva su nombre").
- **No existe botón de borrar ni de reactivar.** Errores del servidor tal cual (nombre repetido incluido).

- [ ] **Step 1:** Implementa. **Step 2:** build + lint. Detente y reporta.

---

### Task 7: El cierre con marcas, productos y créditos

**Files:** Modify `src/CierreObjetivos.jsx`. Create `src/objetivos/CierreElementos.jsx` (tablas de los tres grupos, para no
hacer crecer más `CierreObjetivos.jsx`).

**Interfaces — Consumes:** `llaveCampo`, `armarRealesCierre`, `camposFaltantesCierre`, `vigenteDeElemento`,
`esRectificacionDeElemento`, `pesosConCentavos`, `ETIQUETAS_FINANCIERA` (Task 1).

Requisitos (spec §5):
- **Estado de reales**: sustituye `reales` (por vendedor) por `valores` indexado con `llaveCampo`. El campo de SICAR de
  cada persona usa `llaveCampo(id, "sicar", "")`. Al cargar el previo, inicializa todas las llaves en `""`.
- **Previo**: debajo de la tabla de venta, `CierreElementos` en modo captura: por persona con algún elemento, tres
  grupos (Marcas en pesos, Productos en piezas, Créditos por financiera con `ETIQUETAS_FINANCIERA`). Renglón: elemento ·
  meta · capturado (o registrados) · **real** (campo) · diferencia en vivo (capturado − real; pesos con centavos).
- **Envío**: `reales: armarRealesCierre(previo, valores)`. Antes de abrir la confirmación, `camposFaltantesCierre`; si
  hay faltantes, marca esos campos en rojo y muestra "Faltan N datos por capturar"; no abre la confirmación.
- **Confirmación antes de sellar** (Arreglo 2): el botón actual de cerrar pasa a "Revisar y cerrar" y abre un `Modal`
  con: sucursal (nombre) y mes, número de personas, y cuántas tienen diferencia distinta de cero en venta, marcas,
  productos y créditos. Botones "Sellar el mes" (hace el POST actual) y "Volver". No exige diferencias en cero.
- **Centavos** (Arreglo 1): en `CierreObjetivos.jsx` los importes en pesos (meta, capturado, SICAR, diferencia de venta,
  valores de rectificación de venta) usan `pesosConCentavos` en lugar de `pesos`. Las demás pantallas no cambian.
- **Cierre sellado**: `CierreElementos` en modo lectura por persona: elemento · meta · capturado · real · diferencia, y
  si hay rectificaciones del elemento, "Rectificado: X" con `vigenteDeElemento`. Botón **Rectificar** por elemento:
  `Modal` con campo (Meta / Capturado / Real), valor nuevo y motivo obligatorio →
  `POST /api/objetivos/cierre/:id/rectificar` `{ vendedor_id, campo, valor_nuevo: Number, motivo, [clave]: id }`.
- La lista de rectificaciones muestra también las de elemento, rotuladas "{elemento} · {campo}" (no con `nombresCampos`
  de venta).
- Una persona con créditos y sin ninguna meta aparece en el previo (lo da el servidor) y sus reales de crédito se envían.

- [ ] **Step 1: Prueba que falla** — agrega a `src/objetivos/marcas.test.js`:

```js
test("una persona solo con créditos también envía su real de crédito", () => {
  const soloCreditos = [{ vendedor_id: 9, meta: 0, capturado: 0, marcas: [], productos: [],
    creditos: [{ financiera: "atrato", meta: 0, registrados: 2 }] }];
  const valores = { [llaveCampo(9, "sicar", "")]: "0", [llaveCampo(9, "creditos", "atrato")]: "2" };
  assert.deepEqual(armarRealesCierre(soloCreditos, valores),
    [{ vendedor_id: 9, real_sicar: 0, marcas: [], productos: [], creditos: [{ financiera: "atrato", real: 2 }] }]);
  assert.deepEqual(camposFaltantesCierre(soloCreditos, { [llaveCampo(9, "sicar", "")]: "0" }), [llaveCampo(9, "creditos", "atrato")]);
});
```
  Si pasa de inmediato (la Task 1 ya lo cubre), dilo en el reporte; es una prueba de regresión.
- [ ] **Step 2:** Implementa la pantalla. **Step 3:** `node --test src/objetivos/marcas.test.js`, build, lint. Detente y reporta.

---

## Detente y reporta (no improvises) si

- Una pantalla necesita un dato que el servidor no da, o una ruta responde distinto a lo descrito arriba.
- Cumplir un requisito obliga a tocar `backend/`, `package.json` o un archivo no listado en la task.
- Una prueba existente de `src/` contradice el plan.

## Evidencia de entrega (por cada task)

Archivos cambiados; salida resumida de `node --test` de los archivos de `src/objetivos` tocados; resultado de
`npx vite build` y del lint; cualquier cosa que no pudiste comprobar. Claude revisa el diff, busca mojibake y líneas
> 200, corre la suite y commitea.

## Después de este plan (no es parte de él)

- Prueba en navegador completa por Claude (lista en el spec, sección "Pruebas y verificación").
- Revisión independiente (no Codex) de toda la rama `feature/objetivos-marcas-creditos`, luego merge de Victor.
- Entrega A (tablero con gráficas) y Entrega C (reordenar pantallas existentes).
