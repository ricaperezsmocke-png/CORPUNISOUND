# CORPUNISOUND en celular, tableta y PC — Plan de implementación

> **Para agentes ejecutores:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan casillas (`- [ ]`) para seguimiento.

**Goal:** Que el sistema se pueda usar desde el celular que el vendedor trae en el bolsillo, desde la tableta del mostrador y desde la PC de la caja — sin que una pantalla se rompa, y sin prometer en un celular de 5 pulgadas cosas que solo se pueden hacer bien en el mostrador.

**Architecture:** Esto es **presentación y nada más**. No se toca una sola línea de `backend/`, ni una consulta, ni un permiso, ni una regla de dinero. El trabajo son clases de Tailwind y tres archivos de armazón (`src/App.jsx`, `src/BarraLateral.jsx`, `src/EncabezadoModulo.jsx`). El patrón ya existe dentro del propio sistema: **`src/radar-demanda/` está construido para pantalla chica y funciona**. Ese es el modelo a copiar, no uno inventado.

**Tech Stack:** React 18 + Vite + Tailwind CSS 3.4 + shadcn/ui. **Sin dependencias nuevas** — ver la sección "La pregunta de la dependencia" más abajo: no hace falta ninguna.

**Rama:** `feature/diseno-responsive` · **Worktree:** `C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/diseno-responsive`
**Commit base:** `d345bdf` (master). La rama `docs/fugas-auditoria-0908` (`6f4ed88`) es master más dos documentos: sirve igual de base, pero master es más limpio. **Lo elige Victor al crear el worktree.**

---

## Lo que Victor gana y lo que cuesta — el resumen

| Fase | Qué gana | Riesgo | Tamaño |
|---|---|---|---|
| **0. El armazón** | Poder entrar y navegar desde un celular. Hoy no se puede: el menú se come el 70% de la pantalla. | Bajo — ninguna pantalla de dinero | Mediano |
| **1. Las tablas** | Que las listas anchas se lean deslizando en vez de apelmazarse. Mejora también la tableta del mostrador. | Bajo — no cambia ni una columna | Mediano |
| **2. Los formularios** | Capturar un gasto, un traspaso o un ajuste desde un celular sin campos de 150 px. | Bajo — mecánico | Mediano |
| **3. Consultar existencia en el piso** | El vendedor contesta "¿lo tienes?" sin caminar a la caja. **La que más se va a usar.** | Bajo — solo consulta | Mediano |
| **4. El gasto con foto del comprobante** | El ticket se sube en el momento, no arrugado al final del día. Deja el lugar listo para el QR ya decidido. | Bajo — no toca el guardado | Chico |
| **5. Las de mostrador se declaran** | Nadie intenta cortar caja desde un celular y se lleva la sorpresa a media cuenta. | Bajo | Chico |
| **6. La barra F2-F12 en tableta** | *Opcional, solo si quieres cobrar desde una tableta.* Se decide al llegar. | Medio — es el POS | Mediano |

---

## Global Constraints

- **Sin dependencias nuevas.** Ninguna. Ni de interfaz, ni de layout, ni de iconos.
- **No se toca `backend/`.** Ni una ruta, ni un permiso, ni una consulta. Si una tarea parece necesitarlo, **detenerse y reportar**.
- **No se toca `render.yaml`** ni nada de infraestructura.
- **No se toca `tailwind.config.js`.** Los breakpoints de fábrica (`sm` 640 px, `md` 768 px, `lg` 1024 px, `xl` 1280 px) son los correctos y ya se usan en el Radar.
- **Nunca `git add .`** — staging por rutas explícitas.
- **Nada de push, merge ni rebase.** Eso lo hace Victor. Commits en la rama, sí.
- **Sin acentos en los mensajes de commit.** En el código y en la interfaz, los acentos SÍ van.
- **La PC no puede empeorar.** Cada fase se ve también a 1280 px antes de darla por terminada. Si algo se movió en la PC, no está terminado.
- **Nadie valida su propio trabajo.** Quien implementa no revisa.

---

## Inventario: qué hay hoy

### 1. Cuántas pantallas hay

**51 archivos `.jsx`** en `src/`. En pantallas:

- **15 módulos en el menú lateral** (la lista `MODULOS` de `src/App.jsx`): Punto de Venta, Corte de Caja, Gastos, Inventario y Productos, Traspasos, CRM, Radar de Demanda, MercadoLibre, Mi Objetivo de Venta, Reportes, Estado de Cuenta, Garantías, Roles y Personal, Respaldos, Configuración.
- **+ Login + Inicio** (el Asistente de Negocio) = **17 destinos principales**.
- **Dentro de ellos:** 10 reportes (`src/reportes/`), 5 secciones del Radar (`src/radar-demanda/`), y 6 sub-pantallas que se abren desde un módulo (Consultas de Ventas, Recepción de Compras, Artículo de Compra, Catálogo de Vendedores, Migración de Datos, Predicciones de Demanda).
- **Total: 38 pantallas.** Más **34 usos de un componente `Modal` compartido** y **36 modales escritos a mano** — la captura de este sistema vive sobre todo en modales, no en páginas.

**Las que se usan a diario en la tienda** (y por eso mandan el orden de las fases):

| Pantalla | Archivo | Líneas | Quién la usa |
|---|---|---|---|
| Punto de Venta | `src/PuntoDeVenta.jsx` | 1305 | La cajera, todo el día |
| Inventario y Productos | `src/InventarioProductos.jsx` | 849 | Vendedores y encargado |
| Gastos | `src/Gastos.jsx` | 720 | Encargado y cajera |
| Corte de Caja | `src/CorteCaja.jsx` | 580 | La cajera, al cerrar |
| Consultas de Ventas | `src/ConsultasVentas.jsx` | 496 | Cajera y gerencia |
| CRM | `src/CRM.jsx` | 692 | Vendedores |
| Apartados | `src/ModalApartados.jsx` | 337 | Cajera |
| Garantías | `src/Garantias.jsx` | 815 | Quien gestiona reclamos |
| Radar de Demanda | `src/radar-demanda/` | 917 | Vendedores, en el piso |
| Reportes | `src/reportes/` | 1751 | Gerencia y contador |

### 2. Cómo está hecho el layout hoy

**El armazón** (`src/App.jsx`, línea 85): `w-full h-screen flex` — barra lateral a la izquierda, columna de contenido a la derecha. Ya hay un `min-w-0` puesto a propósito, con un comentario en el código que explica por qué: **sin él, una tabla ancha estira el flex y empuja la barra fuera de la pantalla**. Ese comentario es la mejor evidencia de que el problema de las tablas ya se conocía.

**El menú lateral** (`src/BarraLateral.jsx`): `w-64` abierto (256 px), `w-16` encogido (64 px), con transición. **Nunca se oculta del todo**, y el encogido **no se recuerda entre sesiones a propósito** — decisión de Victor del 2026-08-25. En un celular de 360-390 px, esos 256 px son el 70% de la pantalla.

**El encabezado** (`src/EncabezadoModulo.jsx`): logo + título a la izquierda; selector de sucursal + selector de caja + nombre/rol + botón Salir a la derecha, todo en una sola fila con `shrink-0`. Es lo único del sistema fuera del Radar que ya tiene algo de adaptación: dos `hidden sm:` (el bloque nombre/rol y la palabra "Salir"). Los dos `<select>` (`src/SelectorSucursal.jsx`, `src/SelectorCaja.jsx`) van a su ancho natural, y el de sucursal puede llevar además una etiqueta de error de `⚠ no se pudo cargar la lista de sucursales`.

**Los breakpoints, la cifra que resume todo el diagnóstico:**

```
68 usos de sm:/md:/lg:/xl: en TODO src/
   44 de ellos están en src/radar-demanda/
    4 en src/reportes/ReporteEstadoCuentaClientes.jsx
    6 en los componentes de shadcn (dialog, button, input)
   14 repartidos en el resto del sistema entero
```

Traducido: **el Radar de Demanda es la única parte del sistema pensada para pantalla chica.** Punto de Venta, Corte de Caja, Gastos, Inventario, CRM, Estado de Cuenta y Garantías tienen entre 0 y 2 breakpoints cada uno, sobre miles de líneas. No es que estén mal hechos: es que se hicieron para un monitor y nunca se les pidió otra cosa.

**Lo que sí está bien de origen:** la etiqueta `<meta name="viewport" content="width=device-width, initial-scale=1.0">` está correcta en `index.html`. Sin ella, nada de esto funcionaría; con ella, el navegador del celular ya está haciendo su parte.

### 3. Qué rompe hoy en pantalla chica

1. **La barra lateral se come la pantalla.** 256 px fijos de 390. No se puede cerrar.
2. **Las tablas anchas no tienen scroll horizontal propio.** El contenedor de cada `<table>` en las pantallas de tienda es `overflow-y-auto` o `overflow-auto` sobre toda la zona, no un `overflow-x-auto` alrededor de la tabla. Las columnas por pantalla:

   | Pantalla | Columnas |
   |---|---|
   | Estado de Cuenta | 20 |
   | Corte de Caja | 18 |
   | Reporte de Gastos de Garantías | 16 |
   | Reporte de Gastos | 15 |
   | Gastos | 12 (13 encabezados) |
   | Garantías | 12 |
   | Roles y Personal | 12 |
   | Traspasos | 11 |
   | Reporte de Cortes de Caja | 11 |
   | Inventario | 10 |
   | Consultas de Ventas / Reporte de Ventas (general) | 9 |

   Y el detalle que más molesta: **el componente `src/components/ui/table.jsx` de shadcn SÍ trae su contenedor con `overflow-x-auto` — y ninguna pantalla de tienda lo usa.** Todas escriben `<table>` a mano. La solución ya está en el repositorio, sin estrenar.

3. **La barra F2-F12 del Punto de Venta** (`src/PuntoDeVenta.jsx`, línea 694): `flex overflow-x-auto` con botones de `min-w-[74px]`. Técnicamente se desplaza, pero son hasta 10 botones ≈ 740 px: en un celular se ve el primero y medio. Y los atajos F2…F12 no existen en un teclado de celular; los botones sí responden al toque.
4. **La columna lateral del POS** es `w-24` fija (96 px) con 12 botones (Cerrar, Cancelar ticket, Doc, Cliente, Vendedor, Artículo rápido, Cotización, Nota de crédito, Apartados, Espera, Recuperar, Masiva). Sumada al menú del sistema: **352 px de mobiliario antes de que se vea un solo producto.**
5. **El panel del artículo seleccionado en Inventario** es `w-80` fijo (320 px) al lado de la lista. En un celular no cabe ninguno de los dos.
6. **Los formularios dentro de los modales.** La caja exterior de los modales ya está bien (`w-full max-w-*` + `max-h-[92vh]` + scroll interno): eso no es el problema. El problema es el contenido: **35 rejillas `grid-cols-2/3/4` sin prefijo de breakpoint, repartidas en 16 archivos.** Dos campos lado a lado en la PC son dos campos lado a lado de 150 px en el celular. (Con prefijo hay 20, casi todas en Radar.)
7. **`h-screen`** en `src/App.jsx` y `src/Login.jsx`. En el navegador del celular la barra de direcciones cambia de alto y `100vh` deja contenido debajo del borde de la pantalla.
8. **`select-none`** en Punto de Venta, Corte de Caja, Consultas de Ventas, MercadoLibre, Recepción de Compras y Configuración: en un celular impide seleccionar y copiar un folio o un total. Molestia menor, pero real.

### 4. Qué YA funciona bien en celular hoy — dicho explícitamente

Esto no es un sistema que haya que rehacer. Hay partes que ya están listas:

- **La etiqueta viewport** está correcta. Es la base y ya está puesta.
- **Login** (`src/Login.jsx`): tarjeta `w-full max-w-sm` centrada. **Se ve bien en un celular tal cual está hoy.** Y el GPS que ya pide al entrar es justo donde más sentido tiene.
- **Inicio / Asistente de Negocio** (`src/AsistenteIA.jsx`): `max-w-2xl mx-auto`, burbujas al 85% del ancho, campo de texto abajo. Es una pantalla de chat y **ya está lista para el celular**.
- **Radar de Demanda completo** (los 5 apartados): `px-3 sm:px-6`, botones con `min-h-11` (44 px, el mínimo táctil recomendado), modales que suben desde abajo en celular (`items-end … sm:items-center`), rejillas `sm:grid-cols-2`. **Registrar una demanda desde un celular ya se puede hacer hoy.**
- **El menú de Reportes** (los 10 iconos): `grid-cols-2 sm:grid-cols-3 md:grid-cols-4`. Ya se adapta.
- **Las tres gráficas** (Inventario, Predicciones, Análisis del Radar) usan `ResponsiveContainer` dentro de un contenedor de alto fijo: **se ajustan solas al ancho**. La de Radar hasta apila en vertical (`xl:grid-cols-2`). Lo único que se aprieta son las etiquetas del eje X cuando hay muchos días.
- **La caja exterior de los ~70 modales** ya está bien resuelta.
- **44 campos `type="number"` y 17 `type="date"`**: en un celular ya sacan el teclado numérico y el selector de fecha nativos. Eso ya funciona.

---

## La decisión: qué se ve en el celular y qué NO

Un corte de caja de 18 columnas o un reporte de 12 en un celular de 5 pulgadas **es peor que no ofrecerlo**. Quien cuenta el cajón necesita ver las cuatro formas de pago y la diferencia al mismo tiempo; si hay que desplazar, el número que no se ve es justo el que decide si hay faltante. Por eso el plan reparte las pantallas en tres grupos:

### A — De mostrador (tableta de 768 px en adelante y PC)

**Punto de Venta · Corte de Caja · Estado de Cuenta · Recepción de Compras · los reportes de 9 columnas o más · Roles y Personal · Respaldos · Migración de Datos · Configuración.**

En un celular **se abren igual**, pero con un aviso honesto arriba: *"Esta pantalla está hecha para la tableta del mostrador o la computadora. Aquí se ve apretada."* No se rediseñan para 390 px. Razones concretas: el POS necesita el lector de códigos y el cajón, que están físicamente en el mostrador; el corte necesita ver el conteo completo de un vistazo.

### B — En la mano (celular, se rediseñan para 390 px)

- **Consultar existencia y precio** — Inventario en modo consulta. Es lo que más se pide en el piso de venta: *"¿tienes esta guitarra?"*. Hoy hay que caminar a la caja.
- **Registrar una demanda del Radar** — ya funciona; solo falta poder llegar a él sin pelearse con el menú.
- **Ver un apartado** — qué debe el cliente y cuándo vence.
- **Registrar un gasto con el comprobante desde la cámara** — el formulario ya existe y el `input type=file` en un celular ofrece la cámara.
- **CRM y sus seguimientos** — llamar al cliente desde el teléfono que ya traes en la mano.
- **Inicio / Asistente** — ya funciona.

### C — Lo que se arregla para todos, en cualquier pantalla

Tablas con su propio scroll horizontal, rejillas de formulario que se apilan, alto de pantalla correcto y menú que se puede quitar de en medio. **Esto no es "modo celular": está mal hoy también en la tableta del mostrador.**

### Lo que NO se toca en todo el plan

Ninguna lógica de dinero, ningún permiso, ningún dato, ninguna consulta al backend, ningún archivo de `backend/`. Ni los textos de los avisos de dinero, que están escritos con cuidado y con su razón comentada al lado. Si una tarea parece necesitar tocar algo de eso, **se detiene y se reporta**.

### La pregunta de la dependencia — contestada: no hace falta ninguna

El lugar donde alguien se sentiría tentado a instalar algo es el menú deslizable de la Fase 0 ("drawer" o "sheet"). **No hace falta.** Se hace con lo que ya hay: un `<nav>` con `fixed` + `-translate-x-full` y una capa oscura detrás, exactamente el mismo patrón que ya usan los modales del Radar (`items-end … sm:items-center`). Cero paquetes nuevos. Si durante la ejecución alguien concluye lo contrario, **se detiene y se le pregunta a Victor**; no se instala nada.

---

## Estructura de archivos

| Archivo | Responsabilidad | Fases |
|---|---|---|
| `src/App.jsx` | Alto de pantalla real, estado abierto/cerrado del menú, capa oscura | 0 |
| `src/BarraLateral.jsx` | Menú deslizable en celular, fijo en PC | 0 |
| `src/EncabezadoModulo.jsx` | Botón de menú, encabezado que cabe a 360 px | 0 |
| `src/index.css` | Utilidad de alto de pantalla (`100dvh`) — sin dependencias | 0 |
| `src/Gastos.jsx` | Scroll de tabla, formulario apilado, comprobante desde la cámara | 1, 2, 4 |
| `src/InventarioProductos.jsx` | Scroll de tabla, panel del artículo como hoja inferior | 1, 3 |
| `src/CorteCaja.jsx`, `src/EstadoCuenta.jsx`, `src/Garantias.jsx`, `src/Traspasos.jsx`, `src/ConsultasVentas.jsx`, `src/AdminRoles.jsx`, `src/RecepcionCompras.jsx` | Scroll de tabla | 1 |
| `src/reportes/*.jsx` | Scroll de tabla; barra de filtros que se apila | 1, 2 |
| `src/ModalApartados.jsx` | Apartados legibles en celular | 2, 3 |
| `src/CRM.jsx` | Tarjetas y seguimientos en celular | 2 |
| `src/PuntoDeVenta.jsx` | **Solo el aviso de "pantalla de mostrador"** (Fase 5) y, si Victor lo quiere, la barra F2-F12 en tableta (Fase 6) | 5, 6 |

**Orden:** la Fase 0 habilita todo lo demás — sin ella no se puede ni navegar en un celular, así que nada de lo que venga después se puede probar. Las Fases 1 y 2 son transversales y de riesgo bajo. La 3 y la 4 son las dos funciones que Victor de verdad va a usar en la mano. La 5 cierra el círculo. La 6 se decide al llegar.

---

### Fase 0 — El armazón: que se pueda navegar desde un celular

**Qué gana Victor.** Hoy, desde un celular, el menú ocupa 256 px de 390 y no se puede cerrar: no se llega a ninguna pantalla. Con esta fase, el menú se esconde solo en pantalla chica, se abre con un botón, y se cierra al elegir un módulo. En la PC **no cambia absolutamente nada**.

**Files:**
- Modify: `src/App.jsx` (líneas 84-97: el contenedor raíz)
- Modify: `src/BarraLateral.jsx` (línea 53: el `<nav>`)
- Modify: `src/EncabezadoModulo.jsx` (el bloque izquierdo y el derecho)
- Modify: `src/index.css` (una utilidad de alto, fuera de `@layer` por la razón ya documentada en ese archivo)

**Interfaces:**
- `BarraLateral` recibe dos props nuevas: `abierta` (booleano) y `onCerrar` (función). **El estado vive en `App.jsx`**, que es quien ya maneja `vista`.
- `EncabezadoModulo` recibe `onAbrirMenu`. El botón solo aparece en pantalla chica (`lg:hidden`).
- **No cambia ninguna otra firma.** `usuario`, `vista` y `onEntrarModulo` se quedan igual.

- [ ] **Paso 1: El alto de pantalla correcto.** Reemplazar `h-screen` por un alto que respete la barra de direcciones del navegador móvil (`100dvh` con `100vh` de respaldo, como utilidad en `src/index.css`). Aplicarlo en `src/App.jsx` línea 85 y en `src/Login.jsx` línea 97. Sin esto, el pie de cualquier pantalla queda debajo del borde visible en el celular.
- [ ] **Paso 2: El menú, fijo en PC y deslizable en celular.** En `src/BarraLateral.jsx`, el `<nav>` pasa a `fixed inset-y-0 left-0 z-40 -translate-x-full` con `lg:static lg:translate-x-0`, y `translate-x-0` cuando `abierta`. Conservar la transición que ya tiene y el `rounded-r-2xl`.
- [ ] **Paso 3: La capa oscura.** En `src/App.jsx`, cuando el menú está abierto en pantalla chica, una capa `fixed inset-0 bg-black/40 z-30 lg:hidden` que al tocarla lo cierra. Mismo tono que los modales del sistema (`bg-black/40`), no uno nuevo.
- [ ] **Paso 4: Cerrar al elegir.** Entrar a un módulo desde el menú lo cierra en celular. En PC no se cierra nada porque nunca estuvo flotando.
- [ ] **Paso 5: El botón de menú en el encabezado.** A la izquierda del logo, `lg:hidden`, con `aria-label` y `aria-expanded` como ya hacen los demás botones de la barra. Alto mínimo 44 px.
- [ ] **Paso 6: El encabezado cabe a 360 px.** Que la fila pueda envolver (`flex-wrap`) y que el título use `truncate` (ya lo tiene). Los dos selectores —sucursal y caja— **siguen siendo dos selectores y siguen viéndose**: son la fuente del alcance y esconderlos en celular sería peligroso. Si no caben, envuelven a un segundo renglón.
- [ ] **Paso 7: El encogido no se rompe.** La función de encoger a solo iconos (`w-16`) se conserva tal cual para PC. En celular no aplica: ahí el menú está fuera o dentro, no encogido.
- [ ] **Paso 8: Prueba en navegador.** Los cuatro anchos de la sección de verificación. Entrar, abrir el menú, ir a tres módulos distintos, cerrar el menú tocando la capa oscura. **Y a 1280 px: que no se haya movido nada.**
- [ ] **Paso 9: Lint y commit.** `npx eslint src backend --quiet` en cero.

---

### Fase 1 — Las tablas dejan de apelmazarse (en todos los dispositivos)

**Qué gana Victor.** Una lista de 12 o 20 columnas hoy se comprime hasta que el texto se amontona. Con esta fase se lee deslizando de lado, con el encabezado quieto arriba. **Mejora igual en la tableta del mostrador y no cambia nada en la PC.** No se quita ni se agrega ni una columna: el reporte sigue diciendo exactamente lo mismo.

**Files:**
- Modify: `src/Gastos.jsx`, `src/CorteCaja.jsx`, `src/EstadoCuenta.jsx`, `src/Garantias.jsx`, `src/Traspasos.jsx`, `src/ConsultasVentas.jsx`, `src/InventarioProductos.jsx`, `src/AdminRoles.jsx`, `src/RecepcionCompras.jsx`
- Modify: los 10 archivos de `src/reportes/`

**Interfaces:**
- Patrón único, el mismo que ya trae `src/components/ui/table.jsx` sin estrenar: cada `<table>` va envuelta en `<div className="w-full overflow-x-auto">`, y la tabla lleva un `min-w-[...]` acorde a sus columnas. El precedente exacto ya está en el sistema: `src/radar-demanda/RegistrarDemanda.jsx` línea 166 usa `min-w-[650px]` dentro de un contenedor con scroll.
- **No se cambia ni una columna, ni un dato, ni un formato de número.**

- [ ] **Paso 1: Empezar por Gastos** (12 columnas, uso diario, `src/Gastos.jsx` línea 335). Envolver, poner `min-w-`, comprobar que el `sticky top-0` del encabezado azul sigue funcionando dentro del contenedor nuevo. **Si el sticky se rompe, ese es el detalle que hay que resolver una vez y copiar en todas las demás.**
- [ ] **Paso 2: Verificar en navegador a 390 px** antes de replicar. Deslizar la tabla de lado sin que se mueva la página entera. Una tabla que arrastra toda la pantalla es peor que la de hoy.
- [ ] **Paso 3: Replicar** en Estado de Cuenta (20), Corte de Caja (18), Garantías (12), Roles y Personal (12), Traspasos (11), Inventario (10), Consultas de Ventas (9) y Recepción de Compras.
- [ ] **Paso 4: Los 10 reportes.** Mismo patrón. Ojo con `ReporteVentas.jsx`, que tiene cinco tablas (una por pestaña): las cinco.
- [ ] **Paso 5: El scroll vertical de la página no se rompe.** El contenedor exterior de cada pantalla ya es `flex-1 overflow-y-auto`; el nuevo contenedor va **dentro**, no lo reemplaza.
- [ ] **Paso 6: Prueba en navegador a los cuatro anchos** y captura de la peor tabla (Estado de Cuenta, 20 columnas) en cada uno.
- [ ] **Paso 7: Lint y commit.**

---

### Fase 2 — Los formularios se apilan en lugar de aplastarse

**Qué gana Victor.** Un gasto, un traspaso, un ajuste de inventario o un alta de cliente se pueden llenar desde un celular. Hoy esos formularios ponen dos o tres campos lado a lado también en 390 px, y cada campo queda de 150 px: se escribe a ciegas.

**Files:** los 16 archivos con rejillas sin breakpoint — `src/AdminRoles.jsx`, `src/ArticuloCompra.jsx`, `src/Configuracion.jsx`, `src/ConsultasVentas.jsx`, `src/EstadoCuenta.jsx`, `src/Garantias.jsx`, `src/Gastos.jsx`, `src/InventarioProductos.jsx`, `src/MercadoLibre.jsx`, `src/MigracionDatos.jsx`, `src/PuntoDeVenta.jsx` *(solo los modales, no el armazón)*, `src/RecepcionCompras.jsx`, `src/Reportes.jsx`, y los tres del Radar que ya están bien y solo se revisan.

**Interfaces:**
- Regla mecánica: `grid-cols-2` → `grid-cols-1 sm:grid-cols-2`. `grid-cols-3` → `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`. `grid-cols-4` → `grid-cols-2 sm:grid-cols-4`.
- **Excepción, y hay que pensarla caso por caso:** una rejilla que muestra cifras cortas emparejadas (Precio / Costo en el panel de Inventario, o Calculado / Contado) **se queda en dos columnas**, porque separar dos cifras que se comparan las vuelve inútiles. Apilar no siempre es mejorar.

- [ ] **Paso 1: Listar las 35 rejillas** con su archivo y su línea, y marcar cuáles son "campos de captura" (se apilan) y cuáles son "cifras que se comparan" (no se tocan). **Este paso se entrega y se revisa antes de cambiar nada.**
- [ ] **Paso 2: Aplicar** la regla a las de captura.
- [ ] **Paso 3: La barra de filtros de los reportes** (`src/reportes/FiltroReporte.jsx`) ya es `flex flex-wrap`: comprobar que a 360 px los campos de fecha no se salgan, y darles ancho mínimo si hace falta.
- [ ] **Paso 4: Los botones llegan a 44 px de alto** en las pantallas del grupo B, que es el mínimo para el dedo. El Radar ya lo hace con `min-h-11`: se copia esa clase, no se inventa otra.
- [ ] **Paso 5: Prueba en navegador.** Llenar de punta a punta, a 390 px, el formulario de un gasto y el de un ajuste de inventario. **Sin guardar nada en la base real.**
- [ ] **Paso 6: Lint y commit.**

---

### Fase 3 — Consultar existencia y precio desde el piso de venta

**Qué gana Victor.** La función que más se va a usar del celular. Un cliente pregunta por una guitarra; el vendedor la busca ahí mismo y le dice si la hay y a cuánto, sin caminar a la caja ni interrumpir a la cajera que está cobrando.

**Files:**
- Modify: `src/InventarioProductos.jsx` (el cuerpo, líneas 481-538: lista + panel lateral)

**Interfaces:**
- El panel `w-80` fijo del artículo seleccionado deja de ser una columna en pantalla chica y pasa a ser **una hoja que sube desde abajo**, con el mismo patrón que ya usan los modales del Radar (`items-end … sm:items-center`, `rounded-t-2xl … sm:rounded-2xl`). En pantalla grande sigue siendo la columna de siempre.
- **No cambia ninguna consulta ni ningún dato:** es el mismo `seleccionado` que ya existe, dibujado en otro sitio.

**Límite duro de esta fase.** Consultar **no** es capturar. Esta fase **no toca el catálogo, ni las altas, ni los ajustes de existencia, ni el clonado, ni la baja de productos**. Los botones que escriben (Agregar, Editar, Ajustar, Clonar, Dar de baja) se quedan como están y **no se rediseñan para celular**: son operaciones de mostrador. Es el mismo criterio ya establecido para el Radar.

- [ ] **Paso 1: La lista primero.** En celular, el buscador arriba a todo lo ancho y la lista de productos debajo, ocupando la pantalla completa. La tabla de tres columnas (Clave/Descripción, Exist., Precio) ya es la más estrecha del sistema y cabe.
- [ ] **Paso 2: El artículo, como hoja inferior.** Al tocar un producto en celular, sube la ficha: foto, clave, nombre, categoría, precio, costo, ubicación y **la existencia en grande** — que es el dato por el que se abrió. Se cierra deslizando o con la X.
- [ ] **Paso 3: En pantalla grande, nada cambia.** La lista y el panel `w-80` lado a lado, exactamente como hoy.
- [ ] **Paso 4: El aviso de "Todas las sucursales" se conserva íntegro.** Ese banner explica que la columna Exist. es la suma de todas las tiendas y no corresponde a ninguna. **En un celular importa más que en la PC**, porque quien consulta desde el piso va a leer ese número y a decírselo a un cliente. No se acorta ni se esconde.
- [ ] **Paso 5: La barra de herramientas** (Agregar, Editar, Recargar, Ajustar…) ya es `overflow-x-auto`: se deja deslizable y se comprueba que los botones que escriben sigan apagados con "Todas" y sigan explicando por qué.
- [ ] **Paso 6: Prueba en navegador a 390 px.** Buscar un producto por nombre, abrir su ficha, leer la existencia, cerrarla, buscar otro. Y a 1280 px: idéntico a hoy.
- [ ] **Paso 7: Lint y commit.**

---

### Fase 4 — El gasto con el comprobante desde la cámara

**Qué gana Victor.** El comprobante se sube en el momento en que se paga, con la foto del ticket, en lugar de acumularse arrugado hasta el final del día. El sistema ya obliga a adjuntar comprobante para guardar un gasto; esta fase hace que esa obligación se pueda cumplir desde el teléfono.

**Files:**
- Modify: `src/Gastos.jsx` (el modal "nuevo", líneas 409-534)

**Interfaces:**
- El `<input type="file" accept=".pdf,.jpg,.jpeg,.png">` de la línea 514 **ya ofrece la cámara en un celular**: el navegador lo hace solo. Lo que falta es que se vea y se entienda, no una función nueva.
- **No se toca nada del guardado:** ni `guardar()`, ni la compresión de `src/comprimirImagen.js`, ni el envío en base64, ni la validación del tamaño, ni el control de doble envío (`gastoEnCurso`). Es dinero y ya está resuelto.

**El lugar reservado para el QR.** Está decidido que habrá una función para subir el comprobante desde el celular escaneando un QR. **Este plan no la diseña y no la contradice.** Lo único que hace es dejarle sitio: el bloque del comprobante queda como una zona propia y claramente delimitada dentro del formulario, de modo que añadirle después un segundo camino ("escanear QR" junto a "tomar foto") no obligue a rehacer el formulario. Si al ejecutar esta fase alguien siente la tentación de empezar el QR, **se detiene y lo reporta**.

- [ ] **Paso 1: El formulario del gasto, legible a 390 px.** Con la Fase 2 ya aplicada, verificar que las tres rejillas de dos columnas (Monto/Forma de pago, Proveedor/Factura) se apilen y que el selector de caja y el aviso de origen (cajón / caja fuerte) se lean completos.
- [ ] **Paso 2: El aviso de a qué caja se le descuenta, intacto y visible.** Ese texto —"Este gasto se descontará del efectivo esperado en el corte de la caja X"— es lo que impide que a una cajera le aparezca un faltante que no cometió. **En un celular tiene que verse sin desplazar hacia abajo**, no enterrado al final del formulario.
- [ ] **Paso 3: El comprobante, como zona propia.** Botón grande y táctil (44 px o más) en lugar del `input type=file` desnudo, con el texto claro de que se puede tomar la foto del ticket. La vista previa del archivo elegido —nombre, peso, y el "comprimida desde X MB" que ya existe— se conserva tal cual.
- [ ] **Paso 4: El botón de guardar siempre alcanzable.** El pie del modal ya es `shrink-0` fuera del área de scroll: comprobar que en un celular con el teclado abierto siga visible, y que el mensaje "Adjunta el comprobante para poder guardar" no se pierda.
- [ ] **Paso 5: Prueba en navegador a 390 px.** Abrir el modal, llenar el formulario completo, adjuntar una imagen y comprobar que el botón se habilita. **No guardar contra datos reales.**
- [ ] **Paso 6: Lint y commit.**

---

### Fase 5 — Las pantallas de mostrador se declaran como tales

**Qué gana Victor.** Nadie empieza un corte de caja desde un celular para descubrir a media cuenta que no se puede leer. El sistema lo dice antes, con honestidad, y deja pasar igual a quien solo quiere mirar.

**Files:**
- Modify: `src/PuntoDeVenta.jsx`, `src/CorteCaja.jsx`, `src/EstadoCuenta.jsx`, `src/RecepcionCompras.jsx`, y los reportes de 9 columnas o más

**Interfaces:**
- Un aviso del mismo estilo ámbar que ya usan los banners de "Estás viendo todas las sucursales" (`bg-amber-50 border-amber-300 text-amber-900`), visible solo en pantalla chica (`lg:hidden`). **No bloquea nada**: informa.
- Se escribe **una sola vez** como componente compartido y se usa en las cinco pantallas. No se copia el texto cinco veces.

- [ ] **Paso 1: El componente del aviso**, con el texto que dice qué pantalla es y qué se recomienda: *"Esta pantalla está hecha para la tableta del mostrador o la computadora. Desde el celular se ve apretada."*
- [ ] **Paso 2: Colocarlo** en las cinco pantallas, **debajo** de los avisos de sucursal y de error que ya existen: un aviso de presentación nunca puede tapar uno de dinero.
- [ ] **Paso 3: Comprobar el orden de los avisos** en Corte de Caja, que es la que más banners acumula (sin sucursal, error de carga, error de caja).
- [ ] **Paso 4: Quitar `select-none`** de Punto de Venta, Corte de Caja y Consultas de Ventas, para que en un celular se pueda seleccionar y copiar un folio o un total. Verificar en PC que no cambia nada del comportamiento de selección de filas.
- [ ] **Paso 5: Prueba en navegador** a 390 y a 1280 px.
- [ ] **Paso 6: Lint y commit.**

---

### Fase 6 — La barra F2-F12 en tableta *(opcional — la decide Victor al llegar)*

**No se empieza sin que Victor lo pida.** Solo tiene sentido si quiere cobrar desde una tableta de 10 pulgadas en el mostrador. En un celular el POS no se va a rediseñar en ningún caso: el lector de códigos y el cajón de dinero están físicamente en la caja.

**Qué costaría.** En una tableta de 768-1024 px, el Punto de Venta ya casi cabe; lo que estorba son los 96 px de la columna lateral izquierda y los ~740 px de la barra F2-F12. Se resolvería dejando la barra deslizable (ya lo es) con los botones más importantes primero, y la columna lateral encogible. **Es el archivo más grande y más delicado del sistema (1305 líneas, dinero en cada renglón): va con revisión independiente y prueba en navegador completa, cobrando de verdad en un entorno de prueba.**

- [ ] **Paso 0: Que Victor lo apruebe explícitamente.** Sin eso, esta fase no existe.

---

## Cómo se prueba cada fase — en un navegador de verdad

No es un trámite: es lo único que ninguna prueba automática de este sistema cubre, y el frontend aquí tiene **una sola** prueba automática (`src/menuCategorias.test.js`). Lo que no se vea en el navegador, no está verificado.

**Con Claude in Chrome**, a los cuatro anchos reales, en este orden:

| Ancho | Qué representa | Qué se exige |
|---|---|---|
| **360 px** | Android de gama media — el más estrecho que hay que aguantar | Nada se sale de la pantalla. Sin scroll horizontal de la página completa. |
| **390 px** | iPhone 12/13/14 — el más común | Todo lo del grupo B se usa cómodo con el pulgar. |
| **768 px** | Tableta vertical del mostrador | Las pantallas del grupo A se leen enteras. |
| **1280 px** | La PC de la caja | **Idéntico a antes del cambio.** Si algo se movió, la fase no está terminada. |

**El procedimiento de cada fase:**

```bash
cd backend && node server.js        # backend en :4000
npx vite --port 5173                # frontend
```

Entrar como lo haría una cajera. Al entrar, **el login pide GPS y espera hasta 10 segundos**: si se queda en "Entrando…", esperar, no está colgada.

- [ ] Los cuatro anchos, con captura de pantalla de cada uno.
- [ ] El recorrido completo de la fase, hecho a mano, no descrito.
- [ ] `npx eslint src backend --quiet` → **0 errores** (los ~455 warnings son preexistentes).
- [ ] `cd backend && node --test` → sin regresiones. **Este plan no debería mover ni una prueba**: si alguna cambia de resultado, algo se tocó que no debía tocarse. Detenerse y reportar.

---

## Verificación final, antes de que Victor apruebe el merge

- [ ] Suite completa sin regresiones y eslint en cero.
- [ ] **Revisión independiente del diff completo de la rama.** Quien implementó no revisa. Si lo hizo Codex, la revisión no va a Codex.
- [ ] **`git diff master --stat` no muestra un solo archivo de `backend/`.** Si aparece uno, el plan se salió de su alcance.
- [ ] **Ninguna dependencia nueva:** `git diff master -- package.json package-lock.json` vacío.
- [ ] En navegador, el recorrido de una jornada en celular: entrar → consultar la existencia de un producto → registrar una demanda del Radar → registrar un gasto con foto → ver un apartado.
- [ ] En navegador, el recorrido de una jornada en la PC de la caja: cobrar una venta → cortar caja → abrir un reporte. **Tiene que verse exactamente como el día anterior.**

---

## Preguntas abiertas — las decide Victor, no el plan

1. **¿Con qué se entra desde el celular?** ¿El navegador del teléfono contra el mismo Render, o quieres además que se pueda "añadir a la pantalla de inicio" y se vea como una app? Lo segundo se hace **sin dependencias nuevas**, pero es trabajo aparte de este plan y hay que decidirlo.
2. **¿Quieres cobrar desde una tableta en el mostrador, o la tableta es solo para consultar?** De esto depende que la Fase 6 exista. Si es solo consultar, el plan termina en la Fase 5 y sale más barato.
3. **El menú encogido no se recuerda entre sesiones, a propósito** (decisión tuya del 2026-08-25). En celular tendrá que empezar **cerrado** por fuerza, o no se ve nada. ¿Está bien que ese comportamiento sea distinto en celular que en la PC?
4. **Los reportes anchos en el celular: ¿aviso y ya, o quieres además un "resumen de bolsillo"** con tres o cuatro cifras (ventas de hoy, total del último corte, gastos del día)? Lo segundo es **una pantalla nueva**, no cabe en este plan, y habría que decidir qué cifras y quién las puede ver.
5. **¿Hay alguna pantalla del grupo A que quieras mover al grupo B?** El reparto de arriba es una propuesta razonada, pero tú conoces el uso real: si resulta que alguien sí necesita ver el Estado de Cuenta desde el teléfono, cambia el plan.

---

## Fuera de alcance

- **Nada de `backend/`.** Ni una ruta, ni un permiso, ni una consulta, ni un dato.
- **Ninguna regla de dinero, de caja, de inventario o de alcance por sucursal.** Los avisos que explican de qué caja sale un gasto o por qué "Todas" apaga un botón **se conservan íntegros**: son los que impiden que a una cajera le aparezca un faltante que no cometió.
- **Ninguna dependencia nueva.**
- **El QR para subir el comprobante** — decidido y pendiente, pero **no se diseña aquí**. La Fase 4 solo le deja sitio.
- **Ningún cambio en el Punto de Venta más allá del aviso de la Fase 5**, salvo que Victor apruebe la Fase 6.
- **Modo oscuro.** Se quitó a propósito el 2026-08-25 y no vuelve por la puerta de atrás.
- **Ningún rediseño estético.** El neumorfismo, los colores y la tipografía se quedan exactamente como están. Esto es hacer que quepa, no hacerlo bonito de nuevo.

---

## Decisiones ya cerradas por Victor (2026-09-11) — no se reabren

1. **La Fase 6 está CANCELADA.** La tableta del mostrador es solo para consultar: no se cobra desde
   tableta. `src/PuntoDeVenta.jsx` **no se toca**, ni ahora ni después, salvo un aviso en la Fase 5
   (que no forma parte de este alcance). Si el armazón tienta a "dejarlo listo para táctil", no se
   hace.
2. **Sí va "añadir a la pantalla de inicio"** (manifest + iconos + etiquetas en `index.html`, sin
   dependencias nuevas). Es una **Fase 4b nueva**, posterior a la Fase 4. No se empieza todavía, pero
   el armazón no le cierra la puerta.
3. **Los reportes anchos en el celular llevarán aviso + una pantalla nueva de "resumen de bolsillo"**:
   es una **Fase 7** y **no está aprobada** (falta decidir qué cifras y quién las ve, porque es
   decisión de dinero). No se toca.
4. **El menú encogido no se recuerda entre sesiones, a propósito** (decisión del 2026-08-25): no se le
   agrega persistencia. En celular empieza **cerrado** por fuerza. Esa diferencia entre celular y PC
   está aprobada.

**Orden final del plan:** 0 → 1 → 2 → 3 → 4 → 4b → 5 → (7 cuando se defina).
