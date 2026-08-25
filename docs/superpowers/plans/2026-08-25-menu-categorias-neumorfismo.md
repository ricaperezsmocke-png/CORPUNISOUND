# Menú por categorías + neumorfismo — Plan de implementación

> **Para quien lo ejecute:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development`
> (recomendada) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos
> usan casillas (`- [ ]`) para llevar el avance.

**Meta:** Sustituir la fila de 14 botones del menú por una barra lateral fija con tres
categorías, y darle al sistema un estilo neumórfico con tema claro y oscuro elegible.

**Arquitectura:** La estructura del menú y el filtro de permisos salen a un módulo de datos
puro (`src/menuCategorias.js`) que se prueba con `node --test`; `src/BarraLateral.jsx` solo
dibuja. `src/App.jsx` pasa de layout en columna a layout en fila para que la barra acompañe
a todas las pantallas. El tema vive en variables CSS de `src/index.css`, con `next-themes`
poniendo la clase `.dark` en el `<html>`.

**Stack:** React 18, Vite 5, Tailwind 3 (`darkMode: ["class"]`), `next-themes` (ya
instalado), `lucide-react` para iconos, `node --test` para la única prueba automática.

**Spec:** `docs/superpowers/specs/2026-08-25-menu-categorias-neumorfismo-design.md`

## Restricciones globales

Copiadas del spec. **Aplican a todas las tareas.**

- **Solo se tocan ocho archivos.** Crear: `src/menuCategorias.js`,
  `src/menuCategorias.test.js`, `src/BarraLateral.jsx`. Modificar: `src/App.jsx`,
  `src/Dashboard.jsx`, `src/EncabezadoModulo.jsx`, `src/index.css`, `src/main.jsx`.
  **Cualquier otro archivo de `src/` es zona prohibida.** Si una tarea parece exigir tocar
  otro, detenerse y reportar.
- **Las 14 pantallas de módulo no se tocan.** Reciben menos ancho y nada más.
- **El filtro de permisos no se reescribe.** Se copia tal cual del actual
  `src/Dashboard.jsx`, incluida su lógica de listas. Ver Tarea 1.
- **En tema oscuro las 14 pantallas se seguirán viendo claras.** Es esperado (fase 3), no
  es un defecto que haya que arreglar aquí.
- **El fondo neumórfico nunca es blanco puro.** La sombra clara desaparece contra el blanco
  y el relieve se pierde.
- **El relieve no es la única señal del módulo activo:** el activo lleva además color y peso
  de texto distintos.
- Nunca `git add .` — el repo tiene ~527 archivos sin seguir. Siempre rutas explícitas.
- Nada de `push`, `merge` ni `rebase`. Eso lo hace Victor.
- Todo el texto que ve el usuario va en español, con acentos.

---

### Tarea 1: Módulo de datos del menú, con pruebas

Es la única lógica del trabajo que puede fallar en silencio: si el filtro se equivoca, a
alguien le desaparece un módulo o le aparece uno que no le toca, y nadie se entera hasta que
pasa en la tienda. Por eso va primero y con pruebas de verdad.

**Archivos:**
- Crear: `src/menuCategorias.js`
- Crear (prueba): `src/menuCategorias.test.js`

**Interfaces:**
- Consume: nada.
- Produce, para la Tarea 3:
  - `CATEGORIAS` — arreglo de `{ id, nombre, modulos }`, donde cada módulo es
    `{ id, nombre, modulo, permiso?, hijos? }` y cada hijo es `{ id, nombre }`.
  - `moduloVisible(m, usuario) → boolean`
  - `categoriasVisibles(usuario) → [{ id, nombre, modulos }]` ya filtrado, sin las
    categorías que quedaron vacías.

- [ ] **Paso 1: Escribir la prueba que falla**

Crear `src/menuCategorias.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { CATEGORIAS, moduloVisible, categoriasVisibles } from "./menuCategorias.js";

/** Administrador de verdad: todos los módulos y todos los permisos que el menú pide. */
const ADMIN = {
  modulos: ["pos", "corte", "gastos", "cuenta_comun", "inventario", "crm",
            "radar_demanda", "ml", "reportes", "admin", "respaldos"],
  permisos: ["realizar_corte_caja", "ver_gastos", "ver_estado_cuenta", "realizar_traspasos",
             "gestionar_garantias", "ver_respaldos", "usar_gerente_ventas",
             "editar_objetivos_venta", "ver_radar_demanda", "registrar_demanda",
             "ver_resumen_demanda", "ver_reportes", "editar_configuracion_pos"],
};

test("el administrador ve las tres categorías y los 15 módulos", () => {
  const vistas = categoriasVisibles(ADMIN);
  assert.equal(vistas.length, 3);
  assert.deepEqual(vistas.map((c) => c.id), ["operacion", "comercial", "administracion"]);
  assert.equal(vistas.reduce((n, c) => n + c.modulos.length, 0), 15);
});

test("una categoría sin módulos visibles no se dibuja", () => {
  // Cajera: solo Punto de Venta y Corte de Caja. Comercial y Administración
  // le quedan vacías y no deben aparecer como encabezados muertos.
  const cajera = { modulos: ["pos", "corte"], permisos: ["realizar_corte_caja"] };
  const vistas = categoriasVisibles(cajera);
  assert.deepEqual(vistas.map((c) => c.id), ["operacion"]);
  assert.deepEqual(vistas[0].modulos.map((m) => m.id), ["pos", "corte"]);
});

test("basta CUALQUIERA de los permisos de la lista", () => {
  // A "Mi Objetivo de Venta" se entra por dos puertas distintas: la vendedora
  // con usar_gerente_ventas y la jefatura con editar_objetivos_venta. Con una
  // sola clave, un rol que solo tuviera la de jefatura no vería el módulo.
  const soloJefatura = { modulos: ["pos"], permisos: ["editar_objetivos_venta"] };
  const objetivo = CATEGORIAS
    .flatMap((c) => c.modulos)
    .find((m) => m.id === "gerencia_ventas");
  assert.equal(moduloVisible(objetivo, soloJefatura), true);

  const soloVendedora = { modulos: ["pos"], permisos: ["usar_gerente_ventas"] };
  assert.equal(moduloVisible(objetivo, soloVendedora), true);

  const ninguno = { modulos: ["pos"], permisos: ["cerrar_venta"] };
  assert.equal(moduloVisible(objetivo, ninguno), false);
});

test("un usuario sin listas declaradas no se filtra", () => {
  // El default permisivo del código actual: si el backend todavía no mandó
  // modulos/permisos, se muestra todo en vez de dejar el menú vacío.
  const vistas = categoriasVisibles({});
  assert.equal(vistas.length, 3);
  assert.equal(vistas.reduce((n, c) => n + c.modulos.length, 0), 15);
});

test("hacen falta el módulo Y el permiso, no uno solo", () => {
  const gastos = CATEGORIAS.flatMap((c) => c.modulos).find((m) => m.id === "gastos");
  assert.equal(moduloVisible(gastos, { modulos: ["gastos"], permisos: [] }), false);
  assert.equal(moduloVisible(gastos, { modulos: [], permisos: ["ver_gastos"] }), false);
  assert.equal(moduloVisible(gastos, { modulos: ["gastos"], permisos: ["ver_gastos"] }), true);
});

test("filtrar no muta CATEGORIAS", () => {
  // categoriasVisibles se llama en cada dibujado. Si mutara la fuente, el menú
  // se iría vaciando solo.
  const antes = CATEGORIAS.map((c) => c.modulos.length);
  categoriasVisibles({ modulos: [], permisos: [] });
  assert.deepEqual(CATEGORIAS.map((c) => c.modulos.length), antes);
});

test("Configuración es módulo de primer nivel en administración", () => {
  const admin = CATEGORIAS.find((c) => c.id === "administracion");
  const config = admin.modulos.find((m) => m.id === "configuracion");
  assert.ok(config, "Configuración debe estar en ADMINISTRACIÓN");
  assert.equal(config.modulo, "pos");
  assert.equal(config.permiso, "editar_configuracion_pos");
});

test("las subcategorías cuelgan de Punto de Venta y de Inventario", () => {
  const porId = Object.fromEntries(CATEGORIAS.flatMap((c) => c.modulos).map((m) => [m.id, m]));
  assert.deepEqual(porId.pos.hijos.map((h) => h.id), ["consultas", "apartados"]);
  assert.deepEqual(porId.inventario.hijos.map((h) => h.id), ["recepcion"]);
});
```

- [ ] **Paso 2: Correr la prueba y verla fallar**

```bash
node --test src/menuCategorias.test.js
```

Esperado: FALLA con `Cannot find module` — `src/menuCategorias.js` todavía no existe.

- [ ] **Paso 3: Escribir el módulo**

Crear `src/menuCategorias.js`:

```js
/**
 * menuCategorias.js — La estructura del menú y quién ve qué.
 *
 * Vive aparte de BarraLateral.jsx a propósito: aquí no hay JSX ni iconos, solo
 * datos y funciones puras. Así se puede probar con `node --test`, que es la
 * única prueba automática que este proyecto tiene del lado del frontend, y es
 * justo la parte donde un error no se ve: si el filtro se equivoca, a alguien
 * le falta un módulo y nadie se entera hasta que pasa en la tienda.
 *
 * Los iconos los pone BarraLateral.jsx, que es quien dibuja.
 */

export const CATEGORIAS = [
  {
    id: "operacion",
    nombre: "OPERACIÓN",
    modulos: [
      {
        id: "pos", nombre: "Punto de Venta", modulo: "pos",
        // Estas dos pantallas ya existen dentro de PuntoDeVenta.jsx. Se muestran
        // para que se vean en el mapa del sistema, pero navegan al padre: entrar
        // directo exigiría tocar PuntoDeVenta.jsx, que está fuera de alcance.
        hijos: [
          { id: "consultas", nombre: "Consultas de Ventas" },
          { id: "apartados", nombre: "Apartados" },
        ],
      },
      { id: "corte", nombre: "Corte de Caja", modulo: "corte", permiso: "realizar_corte_caja" },
      { id: "gastos", nombre: "Gastos", modulo: "gastos", permiso: "ver_gastos" },
      {
        id: "inventario", nombre: "Inventario y Productos", modulo: "inventario",
        hijos: [{ id: "recepcion", nombre: "Recepción de Compras" }],
      },
      { id: "traspasos", nombre: "Traspasos entre Sucursales", modulo: "inventario", permiso: "realizar_traspasos" },
    ],
  },
  {
    id: "comercial",
    nombre: "COMERCIAL",
    modulos: [
      { id: "crm", nombre: "CRM", modulo: "crm" },
      { id: "radar_demanda", nombre: "Radar de Demanda", modulo: "radar_demanda",
        permiso: ["ver_radar_demanda", "registrar_demanda", "ver_resumen_demanda"] },
      { id: "ml", nombre: "MercadoLibre", modulo: "ml" },
      { id: "gerencia_ventas", nombre: "Mi Objetivo de Venta", modulo: "pos",
        permiso: ["usar_gerente_ventas", "editar_objetivos_venta"] },
    ],
  },
  {
    id: "administracion",
    nombre: "ADMINISTRACIÓN",
    modulos: [
      { id: "reportes", nombre: "Reportes", modulo: "reportes", permiso: "ver_reportes" },
      { id: "estado_cuenta", nombre: "Estado de Cuenta", modulo: "cuenta_comun", permiso: "ver_estado_cuenta" },
      // Garantías vive aquí y no en operación: quien la usa a diario no es la
      // cajera sino quien gestiona el reclamo.
      { id: "garantias", nombre: "Garantías", modulo: "inventario", permiso: "gestionar_garantias" },
      { id: "roles", nombre: "Roles y Personal", modulo: "admin" },
      { id: "respaldos", nombre: "Respaldos", modulo: "respaldos", permiso: "ver_respaldos" },
      { id: "configuracion", nombre: "Configuración", modulo: "pos", permiso: "editar_configuracion_pos" },
    ],
  },
];

/**
 * ¿Este rol ve este módulo?
 *
 * Copiado tal cual del Dashboard.jsx anterior, con su lógica de listas intacta:
 * `permiso` acepta una clave O UNA LISTA, y basta tener CUALQUIERA. No es un
 * descuido — hay módulos con dos puertas. A "Mi Objetivo de Venta" entra la
 * vendedora (usar_gerente_ventas) y también la jefatura (editar_objetivos_venta).
 * Con una sola clave, un rol que solo tuviera el de jefatura no veía el módulo y
 * le "desaparecía" sin explicación.
 *
 * Los `!usuario?.modulos` / `!usuario?.permisos` son un default permisivo a
 * propósito: si el backend todavía no mandó las listas, más vale mostrar de más
 * que dejar el menú vacío. Las rutas del backend son la defensa de verdad.
 */
export function moduloVisible(m, usuario) {
  const moduloOk = !usuario?.modulos || usuario.modulos.includes(m.modulo);
  const requeridos = m.permiso ? [].concat(m.permiso) : [];
  const permisoOk =
    requeridos.length === 0 ||
    !usuario?.permisos ||
    requeridos.some((clave) => usuario.permisos.includes(clave));
  return moduloOk && permisoOk;
}

/**
 * Las categorías que este rol debe ver, ya sin los módulos que no le tocan y
 * sin las categorías que se quedaron vacías: un encabezado que no lleva a nada
 * solo le enseña al usuario lo que no puede hacer.
 *
 * Devuelve copias. CATEGORIAS no se muta nunca: esto se llama en cada dibujado
 * y una mutación iría vaciando el menú solo.
 */
export function categoriasVisibles(usuario) {
  return CATEGORIAS
    .map((c) => ({ ...c, modulos: c.modulos.filter((m) => moduloVisible(m, usuario)) }))
    .filter((c) => c.modulos.length > 0);
}
```

- [ ] **Paso 4: Correr la prueba y verla pasar**

```bash
node --test src/menuCategorias.test.js
```

Esperado: `# pass 8`, `# fail 0`.

- [ ] **Paso 5: Commit**

```bash
git add src/menuCategorias.js src/menuCategorias.test.js
git commit -m "feat(menu): la estructura del menu y el filtro de permisos, con pruebas"
```

---

### Tarea 2: Tema oscuro y utilidades neumórficas

**Archivos:**
- Modificar: `src/index.css`
- Modificar: `src/main.jsx`

**Interfaces:**
- Consume: nada.
- Produce, para las Tareas 3 y 4: las clases `.neu`, `.neu-hundido`, `.neu-boton`; la
  variable `--encabezado-fondo`; y un `ThemeProvider` montado, de modo que `useTheme()` de
  `next-themes` funcione en cualquier componente.

No lleva prueba automática: es CSS, y el proyecto no tiene forma de probarlo salvo mirándolo.

- [ ] **Paso 1: Cambiar el fondo claro y agregar las variables neumórficas**

En `src/index.css`, dentro del bloque `@layer base { :root { … } }` que ya existe, cambiar
**solo** esta línea:

```css
    --background: 0 0% 100%;
```

por:

```css
    /* Gris muy claro, no blanco puro: el neumorfismo necesita un tono medio o
       la sombra clara desaparece contra el fondo y el relieve se pierde. */
    --background: 218 31% 93%;
```

Y agregar al final de ese mismo bloque `:root`, después de `--radius`:

```css
    /* Neumorfismo. El fondo sigue a --background para que el relieve se funda
       con la pantalla; solo las dos luces cambian entre claro y oscuro. */
    --neu-fondo: hsl(var(--background));
    --neu-luz: #ffffff;
    --neu-sombra: #c3ccd9;
    --neu-distancia: 6px;
    --neu-difuminado: 12px;
    --encabezado-fondo: linear-gradient(90deg, #1a7fe8 0%, #1262b8 100%);
```

- [ ] **Paso 2: Agregar el bloque oscuro**

En `src/index.css`, dentro de `@layer base`, justo después del bloque `:root`:

```css
  /* next-themes pone esta clase en el <html>. Los nombres son los mismos que
     en :root — ninguno se inventa ni se renombra, solo cambian los valores. */
  .dark {
    --background: 220 23% 15%;
    --foreground: 210 30% 92%;
    --card: 220 22% 19%;
    --card-foreground: 210 30% 92%;
    --popover: 220 22% 19%;
    --popover-foreground: 210 30% 92%;
    --primary: 211 85% 58%;
    --primary-foreground: 220 25% 10%;
    --secondary: 220 18% 24%;
    --secondary-foreground: 210 30% 92%;
    --muted: 220 18% 24%;
    --muted-foreground: 215 15% 65%;
    --accent: 220 18% 24%;
    --accent-foreground: 210 30% 92%;
    --destructive: 0 72% 55%;
    --destructive-foreground: 0 0% 100%;
    --border: 220 16% 28%;
    --input: 220 16% 28%;
    --ring: 211 85% 58%;

    --neu-luz: #262e3d;
    --neu-sombra: #141922;
    --encabezado-fondo: linear-gradient(90deg, #17529b 0%, #0f3f78 100%);
  }
```

- [ ] **Paso 3: Agregar las utilidades neumórficas**

En `src/index.css`, dentro del `@layer utilities` que ya existe, después de las animaciones
y **antes** del `@media (prefers-reduced-motion: reduce)` que ya está ahí:

```css
  /* Neumorfismo: dos sombras opuestas, una luz arriba-izquierda y una sombra
     abajo-derecha, sobre un fondo del mismo tono. Solo para el mobiliario
     (barra, tarjetas, botones de navegación) — nunca para tablas ni cifras,
     donde el relieve suave le quita contraste al dato. */
  .neu {
    background: var(--neu-fondo);
    box-shadow:
      var(--neu-distancia) var(--neu-distancia) var(--neu-difuminado) var(--neu-sombra),
      calc(var(--neu-distancia) * -1) calc(var(--neu-distancia) * -1) var(--neu-difuminado) var(--neu-luz);
  }

  /* Hundido: las mismas sombras hacia adentro. Es el estado del módulo activo. */
  .neu-hundido {
    background: var(--neu-fondo);
    box-shadow:
      inset var(--neu-distancia) var(--neu-distancia) var(--neu-difuminado) var(--neu-sombra),
      inset calc(var(--neu-distancia) * -1) calc(var(--neu-distancia) * -1) var(--neu-difuminado) var(--neu-luz);
  }

  /* Salido en reposo, hundido al presionar. Distancias más cortas que .neu
     porque un botón con 6px de relieve se ve inflado. */
  .neu-boton {
    background: var(--neu-fondo);
    box-shadow:
      3px 3px 6px var(--neu-sombra),
      -3px -3px 6px var(--neu-luz);
    transition: box-shadow 140ms var(--ease-out);
  }

  .neu-boton:active {
    box-shadow:
      inset 3px 3px 6px var(--neu-sombra),
      inset -3px -3px 6px var(--neu-luz);
  }
```

Y agregar `.neu-boton` a la lista del `@media (prefers-reduced-motion: reduce)` que ya
existe al final del archivo:

```css
  @media (prefers-reduced-motion: reduce) {
    .animate-overlay-in,
    .animate-panel-in,
    .animate-toast-in {
      animation-duration: 1ms;
    }
    .neu-boton {
      transition-duration: 1ms;
    }
  }
```

- [ ] **Paso 4: Montar el ThemeProvider**

En `src/main.jsx`, envolver `<App />` en el provider:

```jsx
import { ThemeProvider } from "next-themes";
```

```jsx
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
    <App />
  </ThemeProvider>
```

`attribute="class"` es obligatorio: es lo que espera `darkMode: ["class"]` de
`tailwind.config.js`.

`enableSystem={false}` es a propósito y no hay que "mejorarlo": el sistema lo usan varias
personas en el mismo equipo de tienda, y que el tema cambie solo al anochecer porque Windows
lo decidió es una sorpresa, no una función.

Efecto secundario esperado y bueno: `src/components/ui/sonner.jsx` ya llama a `useTheme()` y
hoy no recibe ningún provider. Con esto empieza a funcionar solo. **No hay que tocarlo.**

- [ ] **Paso 5: Verificar que compila**

```bash
npm run build
```

Esperado: `✓ built in …`, sin errores.

- [ ] **Paso 6: Verificar el tema oscuro a mano**

Levantar `npm run dev`, abrir la app, y en la consola del navegador:

```js
document.documentElement.classList.add("dark")
```

Esperado: el fondo de la pantalla de inicio se oscurece. Las 14 pantallas de módulo siguen
claras — **eso es correcto en esta fase**, ver Restricciones globales. Quitar la clase con
`.remove("dark")` y confirmar que vuelve a claro.

- [ ] **Paso 7: Commit**

```bash
git add src/index.css src/main.jsx
git commit -m "feat(tema): tokens del modo oscuro y utilidades neumorficas"
```

---

### Tarea 3: La barra lateral

**Archivos:**
- Crear: `src/BarraLateral.jsx`

**Interfaces:**
- Consume, de la Tarea 1: `categoriasVisibles(usuario)`.
- Consume, de la Tarea 2: `.neu`, `.neu-hundido`, `.neu-boton`, y el `ThemeProvider`.
- Produce, para la Tarea 4: `export default function BarraLateral({ usuario, vista, onEntrarModulo, onSalir })`.

En esta tarea la barra todavía no se monta en ningún lado — se escribe y se comprueba que
compila. Se ve en la Tarea 4.

- [ ] **Paso 1: Escribir el componente**

Crear `src/BarraLateral.jsx`:

```jsx
import React, { useState } from "react";
import {
  ShoppingCart, Landmark, Wallet, Boxes, ArrowRightLeft,
  Users, RadioTower, Store, Target,
  FileBarChart, Scale, ShieldAlert, ShieldCheck, DatabaseBackup, Settings,
  ChevronRight, LogOut, Sun, Moon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { categoriasVisibles } from "./menuCategorias.js";

/**
 * BarraLateral.jsx — El menú del sistema.
 *
 * Solo dibuja. Qué módulos existen y quién ve cuáles vive en menuCategorias.js,
 * que es código puro y sí tiene pruebas. Aquí solo se le ponen los iconos y el
 * relieve.
 *
 * La barra acompaña a TODAS las pantallas, no solo al inicio: cambiar de Punto
 * de Venta a Corte de Caja es un clic, sin pasar por el inicio.
 */

/** El icono de cada módulo. Se queda aquí y no en menuCategorias.js para que
 *  ese archivo no dependa de React y se pueda probar con `node --test`. */
const ICONOS = {
  pos: ShoppingCart,
  corte: Landmark,
  gastos: Wallet,
  inventario: Boxes,
  traspasos: ArrowRightLeft,
  crm: Users,
  radar_demanda: RadioTower,
  ml: Store,
  gerencia_ventas: Target,
  reportes: FileBarChart,
  estado_cuenta: Scale,
  garantias: ShieldAlert,
  roles: ShieldCheck,
  respaldos: DatabaseBackup,
  configuracion: Settings,
};

function InterruptorTema() {
  const { theme, setTheme } = useTheme();
  const oscuro = theme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(oscuro ? "light" : "dark")}
      className="neu-boton w-full flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-foreground/70 hover:text-foreground"
      aria-label={oscuro ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
    >
      {oscuro ? <Sun size={14} /> : <Moon size={14} />}
      {oscuro ? "Tema claro" : "Tema oscuro"}
    </button>
  );
}

export default function BarraLateral({ usuario, vista, onEntrarModulo, onSalir }) {
  const categorias = categoriasVisibles(usuario);
  const [desplegado, setDesplegado] = useState({});

  return (
    <nav className="neu shrink-0 w-60 h-full flex flex-col rounded-r-2xl overflow-y-auto">
      <div className="shrink-0 px-4 py-4">
        <img src="/logo-unisound.jpg" alt="Unisound" className="h-10 object-contain bg-white rounded-lg px-2 py-1" />
      </div>

      <div className="flex-1 min-h-0 px-3 pb-3 space-y-4">
        {categorias.map((categoria) => (
          <div key={categoria.id}>
            <div className="px-2 pb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground">
              {categoria.nombre}
            </div>

            <div className="space-y-1">
              {categoria.modulos.map((m) => {
                const Icono = ICONOS[m.id];
                const activo = vista === m.id;
                const abierto = !!desplegado[m.id];

                return (
                  <div key={m.id}>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onEntrarModulo(m.id)}
                        // El relieve NO es la única señal del módulo activo: lleva
                        // también color y peso de texto, para quien no distinga
                        // sombras suaves.
                        className={`flex-1 flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] transition-colors ${
                          activo
                            ? "neu-hundido font-semibold text-primary"
                            : "neu-boton text-foreground/80 hover:text-foreground"
                        }`}
                      >
                        {Icono && <Icono size={15} className="shrink-0" />}
                        <span className="truncate">{m.nombre}</span>
                      </button>

                      {m.hijos && (
                        <button
                          type="button"
                          onClick={() => setDesplegado((d) => ({ ...d, [m.id]: !d[m.id] }))}
                          className="neu-boton shrink-0 rounded-lg p-1.5 text-muted-foreground"
                          aria-label={abierto ? `Ocultar lo de ${m.nombre}` : `Ver lo de ${m.nombre}`}
                          aria-expanded={abierto}
                        >
                          <ChevronRight size={13} className={`transition-transform ${abierto ? "rotate-90" : ""}`} />
                        </button>
                      )}
                    </div>

                    {/* Los hijos navegan al módulo padre: entrar directo a la
                        sub-pantalla exigiría tocar PuntoDeVenta.jsx e
                        InventarioProductos.jsx, que están fuera de alcance. */}
                    {m.hijos && abierto && (
                      <div className="mt-1 ml-6 space-y-0.5">
                        {m.hijos.map((h) => (
                          <button
                            key={h.id}
                            type="button"
                            onClick={() => onEntrarModulo(m.id)}
                            className="w-full rounded-lg px-3 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
                          >
                            {h.nombre}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="shrink-0 px-3 py-3 space-y-2">
        <InterruptorTema />
        {usuario && (
          <div className="px-3">
            <div className="text-xs font-semibold text-foreground truncate">{usuario.nombre}</div>
            <div className="text-[11px] text-muted-foreground truncate">{usuario.rol}</div>
          </div>
        )}
        <button
          type="button"
          onClick={onSalir}
          className="neu-boton w-full flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-foreground/70 hover:text-destructive"
        >
          <LogOut size={14} /> Salir
        </button>
      </div>
    </nav>
  );
}
```

- [ ] **Paso 2: Verificar que compila y que no hay errores de lint**

```bash
npm run build
npx eslint src/BarraLateral.jsx
```

Esperado: build `✓ built in …`; eslint sin **errores** (los warnings de imports sin usar son
preexistentes del proyecto y no cuentan).

- [ ] **Paso 3: Commit**

```bash
git add src/BarraLateral.jsx
git commit -m "feat(menu): la barra lateral con categorias, subcategorias y tema"
```

---

### Tarea 4: Montar la barra y adelgazar lo que quedó duplicado

Las tres piezas van juntas porque entre una y otra el sistema queda visiblemente roto (dos
encabezados encima del otro): no tiene sentido que un revisor apruebe una sin las demás.

**Archivos:**
- Modificar: `src/App.jsx`
- Modificar: `src/Dashboard.jsx`
- Modificar: `src/EncabezadoModulo.jsx`

**Interfaces:**
- Consume, de la Tarea 3: `BarraLateral({ usuario, vista, onEntrarModulo, onSalir })`.

- [ ] **Paso 1: `App.jsx` — layout en fila, barra montada, vista de Configuración**

Agregar los dos imports:

```jsx
import BarraLateral from "./BarraLateral.jsx";
import Configuracion from "./Configuracion.jsx";
```

Agregar `"configuracion"` al arreglo `MODULOS` (el de `src/App.jsx:21`, que es la lista de
ids de vista — no confundir con las CATEGORIAS de la Tarea 1):

```jsx
const MODULOS = ["pos", "inventario", "roles", "crm", "corte", "ml", "traspasos", "garantias", "gastos", "reportes", "estado_cuenta", "respaldos", "gerencia_ventas", "radar_demanda", "configuracion"];
```

Sustituir el `return` completo por:

```jsx
  return (
    <div className="w-full h-screen flex bg-background">
      <BarraLateral
        usuario={usuario}
        vista={vista}
        onEntrarModulo={(id) => setVista(id)}
        onSalir={salir}
      />

      {/* min-w-0 es obligatorio: sin él, una tabla ancha estira el flex y
          empuja la barra fuera de la pantalla. */}
      <div className="flex-1 min-w-0 flex flex-col">
        <EncabezadoModulo vista={vista} usuario={usuario} onSalir={salir} />

        <div className="flex-1 min-h-0 overflow-auto">
          {/* …aquí van TODOS los bloques {vista === "…" && …} tal como están hoy,
              sin cambiarles una sola prop… */}

          {/* Y se agrega este, nuevo: */}
          {vista === "configuracion" && (
            <Configuracion
              onVolverAVenta={() => setVista("pos")}
              onVolverInicio={() => setVista("dashboard")}
              permisos={usuario.permisos}
            />
          )}

          {esDashboard && (
            <Dashboard usuario={usuario} />
          )}
        </div>
      </div>
    </div>
  );
```

Tres cosas que **no** hay que cambiar de paso:

- Los `onVolver` que recibe cada módulo se conservan tal cual. Con barra fija dejan de ser
  el camino principal, pero varios módulos los usan internamente para volver desde una
  sub-pantalla y quitarlos rompe archivos fuera de alcance.
- `EncabezadoModulo` ya no recibe `onVolver` (desaparece su botón "‹ Inicio" en el Paso 3),
  pero sí sigue recibiendo `vista`: la usa para el título del módulo, que se conserva.
- `Dashboard` ya no recibe `onEntrarModulo` ni `onSalir`: la barra se encarga de ambos.

- [ ] **Paso 2: `Dashboard.jsx` — que se quede solo con el asistente**

Borrar el arreglo `MODULOS`, el filtro `modulosVisibles` y el `<header>` completo (todo eso
se mudó a `BarraLateral.jsx` y a `App.jsx`). El archivo queda así entero:

```jsx
import React from "react";
import AsistenteIA from "./AsistenteIA";
import { Badge } from "@/components/ui/badge";

/**
 * Dashboard.jsx — La pantalla de inicio.
 *
 * Antes era el menú Y el asistente. El menú se mudó a BarraLateral.jsx y el
 * encabezado a App.jsx, así que aquí solo queda el asistente. En la fase 2 este
 * archivo recibe las tarjetas de métricas.
 */
export default function Dashboard({ usuario }) {
  if (usuario?.permisos && !usuario.permisos.includes("usar_asistente_ia")) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground text-sm px-6 text-center">
        <Badge variant="outline" className="text-xs">Acceso restringido</Badge>
        <p>Tu rol no tiene acceso al Asistente de IA. Usa los módulos del menú o pide al administrador que habilite el permiso.</p>
      </div>
    );
  }
  return <AsistenteIA />;
}
```

Nótese que el texto del mensaje cambió de "los módulos de arriba" a "los módulos del menú":
ya no están arriba, están a la izquierda.

- [ ] **Paso 3: `EncabezadoModulo.jsx` — quitar solo el botón "‹ Inicio"**

Borrar el `<Button>` de "‹ Inicio" (ya no hace falta: la barra siempre está) y la prop
`onVolver` de la firma, que queda `({ vista, usuario, onSalir })`.

**El mapa `TITULOS` y el `<span>` del título SE QUEDAN.** Es lo que muestra el boceto que
Victor aprobó: la barra marca el módulo activo, pero el título en el encabezado es la
respuesta grande a "¿dónde estoy?". Agregarle la entrada que falta:

```jsx
  configuracion: "Configuración",
```

Cambiar el `style` en línea del `<header>` para que lea la variable de la Tarea 2:

```jsx
      style={{ background: "var(--encabezado-fondo)" }}
```

Quitar el import de `ChevronLeft` de `lucide-react` (queda solo `LogOut`). `Button` se sigue
usando para el botón Salir — no quitarlo.

- [ ] **Paso 4: Verificar que compila y que no hay errores de lint**

```bash
npm run build
npx eslint src/App.jsx src/Dashboard.jsx src/EncabezadoModulo.jsx
```

Esperado: build `✓ built in …`; eslint sin errores.

- [ ] **Paso 5: Volver a correr la prueba de la Tarea 1**

```bash
node --test src/menuCategorias.test.js
```

Esperado: `# pass 8`, `# fail 0`. Si falla aquí, algo de esta tarea tocó la Tarea 1, que no
debía.

- [ ] **Paso 6: Commit**

```bash
git add src/App.jsx src/Dashboard.jsx src/EncabezadoModulo.jsx
git commit -m "feat(menu): la barra acompana a todas las pantallas"
```

---

### Tarea 5: Verificación en navegador

Es la única red de verdad de este trabajo: no hay pruebas automáticas de interfaz y no se
van a montar. **Esta tarea no se salta ni se declara hecha sin haber abierto el navegador.**

**Archivos:** ninguno (salvo que aparezca un defecto, en cuyo caso se corrige el archivo que
lo tenga, siempre dentro de los ocho autorizados).

- [ ] **Paso 1: Levantar el sistema**

Dos terminales:

```bash
cd backend && node server.js
```

```bash
npm run dev
```

Vite avisa en qué puerto quedó (5173, o el siguiente si está ocupado).

- [ ] **Paso 2: Preparar las tres cuentas de prueba**

El snapshot local `backend/datos.sqlite` (que está en `.gitignore` — no es la base de
producción) trae un solo usuario, `victor`, Administrador. Para probar los otros dos roles
hay que crear dos cuentas desde Roles y Personal, con los roles "Gerente de sucursal" y
"Cajero" que ya existen en el snapshot.

Si nadie recuerda la contraseña de `victor`:

```bash
node backend/resetPasswordLocal.js victor <contraseña-nueva>
```

Ese script se niega a correr con el backend levantado — hay que bajarlo primero, correrlo y
volver a levantarlo. Es a propósito: el servidor guarda el estado en memoria y reescribiría
el cambio.

- [ ] **Paso 3: Recorrer la lista, anotando el resultado de cada renglón**

| # | Prueba | Qué debe pasar |
|---|---|---|
| 1 | Entrar como Administrador | Ve las tres categorías y los 15 módulos |
| 2 | Entrar como Gerente de sucursal | Ve solo sus categorías; **ninguna categoría vacía se dibuja** |
| 3 | Entrar como Cajero | ADMINISTRACIÓN no aparece por ningún lado |
| 4 | Abrir las 15 pantallas desde la barra, una por una | Todas cargan y se dibujan completas, más angostas |
| 5 | Estando en Punto de Venta, clic en Corte de Caja | Entra directo, sin pasar por el inicio |
| 6 | Módulo activo | Se distingue por color y grosor de letra, no solo por el relieve |
| 7 | Desplegar Punto de Venta e Inventario | Aparecen los hijos y navegan al módulo padre |
| 8 | Interruptor de tema | Barra y encabezado cambian; **las 14 pantallas siguen claras, es lo esperado** |
| 9 | Recargar la página (F5) con tema oscuro puesto | Sigue en oscuro |
| 10 | Abrir cualquier modal (ej. Roles y Personal → Agregar) | Sigue centrado sobre la pantalla completa, tapando la barra |
| 11 | Abrir Mi Objetivo de Venta | Revisar si el `min-w-[560px]` le mete scroll horizontal (ver abajo) |
| 12 | Un aviso cualquiera (guardar algo) | El toast sigue apareciendo abajo y centrado |

Sobre el renglón 11: `src/GerenciaVentas.jsx` tiene el único ancho mínimo grande del
proyecto. Con la barra puesta puede aparecerle scroll horizontal en pantallas angostas.
**Si pasa, se anota y se reporta — no se arregla aquí:** ese archivo está fuera de los ocho
autorizados.

- [ ] **Paso 4: Reportar**

Escribir el resultado de los 12 renglones. Si alguno falló, decir cuál y qué se vio, sin
declarar la tarea terminada.

- [ ] **Paso 5: Commit (solo si hubo correcciones)**

```bash
git add <los archivos que se hayan corregido>
git commit -m "fix(menu): <lo que se corrigio de la prueba en navegador>"
```

---

## Cierre

Cuando las cinco tareas estén hechas:

1. **Revisión independiente de toda la rama**, no solo por tarea. Nadie valida su propio
   trabajo. Es la que atrapa lo que cruza varias tareas.
2. `npm run build` y `node --test src/menuCategorias.test.js` en verde, y `npx eslint src`
   sin errores nuevos.
3. `git diff --check` limpio (sin espacios en blanco al final ni conflictos a medias).
4. Confirmar que `git diff master --stat` no lista ningún archivo fuera de los ocho
   autorizados de las Restricciones globales.
5. **Victor decide el merge y el push.** No se hacen desde aquí.

Las fases 2 (dashboard de métricas) y 3 (barrido de las 2,053 clases de color) tienen su
propio spec y su propia aprobación. **No se empiezan desde esta rama.**
